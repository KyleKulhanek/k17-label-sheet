import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { importFiles } from './importer';
import {
  calibrationFromPlainPaper,
  calibrationFromStock,
  downloadBytes,
  generateCalibrationPdf,
  generateSheetPdf,
  generateStockCalibrationPdf,
  resolveRotation,
} from './pdf';
import {
  BUILTIN_TEMPLATES,
  slotRect,
  templateSearchText,
  validateTemplate,
} from './templates';
import type { Calibration, LabelItem, Rect, SheetTemplate } from './types';

const DEFAULT_CAL: Calibration = {
  id: 'none',
  name: 'No calibration',
  offsetXmm: 0,
  offsetYmm: 0,
  scaleX: 1,
  scaleY: 1,
};
const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
};
const saveJson = (key: string, value: unknown) =>
  localStorage.setItem(key, JSON.stringify(value));
const pageLabel = (item: LabelItem) =>
  item.pageCount > 1
    ? `${item.filename} · page ${item.pageIndex + 1}`
    : item.filename;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function CropPreview({
  item,
  alt = '',
  rotation = item.rotation,
}: {
  item: LabelItem;
  alt?: string;
  rotation?: number;
}) {
  const [url, setUrl] = useState(item.previewUrl);
  const cropKey = `${item.previewUrl}:${item.crop.x}:${item.crop.y}:${item.crop.width}:${item.crop.height}:${rotation}`;
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const sourceW = Math.max(1, image.naturalWidth * item.crop.width);
      const sourceH = Math.max(1, image.naturalHeight * item.crop.height);
      const scale = Math.min(1, 800 / Math.max(sourceW, sourceH));
      const w = Math.max(1, Math.round(sourceW * scale));
      const h = Math.max(1, Math.round(sourceH * scale));
      const turned = rotation % 180 !== 0;
      const canvas = document.createElement('canvas');
      canvas.width = turned ? h : w;
      canvas.height = turned ? w : h;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
        image,
        item.crop.x * image.naturalWidth,
        item.crop.y * image.naturalHeight,
        sourceW,
        sourceH,
        -w / 2,
        -h / 2,
        w,
        h,
      );
      if (!cancelled) setUrl(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.src = item.previewUrl;
    return () => {
      cancelled = true;
    };
  }, [cropKey, item.crop, item.previewUrl, rotation]);
  return (
    <span className="cropped-preview">
      <img src={url} alt={alt} />
    </span>
  );
}

function SortableLabel({
  item,
  slot,
  onChange,
  onDelete,
  onCrop,
}: {
  item: LabelItem;
  slot?: number;
  onChange: (next: LabelItem) => void;
  onDelete: () => void;
  onCrop: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`label-card ${isDragging ? 'dragging' : ''}`}
    >
      <button
        className="drag-handle"
        aria-label={`Reorder ${pageLabel(item)}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="thumb">
        <CropPreview item={item} />
      </div>
      <div className="label-meta">
        <strong>{pageLabel(item)}</strong>
        <span>
          {item.kind === 'pdf'
            ? `${(item.widthPt / 72).toFixed(2)} × ${(item.heightPt / 72).toFixed(2)} in`
            : `${Math.round(item.widthPt)} × ${Math.round(item.heightPt)} px`}{' '}
          · {item.cropStatus} crop
        </span>
        <span className={slot === undefined ? 'muted' : 'assignment'}>
          {slot === undefined
            ? 'Waiting for an available slot'
            : `Assigned to slot ${slot + 1}`}
        </span>
      </div>
      <div className="label-actions">
        <button
          title="Rotate left and override automatic orientation"
          onClick={() =>
            onChange({
              ...item,
              orientation: 'manual',
              rotation: ((item.rotation + 270) % 360) as LabelItem['rotation'],
            })
          }
        >
          ↶
        </button>
        <button
          title="Rotate right and override automatic orientation"
          onClick={() =>
            onChange({
              ...item,
              orientation: 'manual',
              rotation: ((item.rotation + 90) % 360) as LabelItem['rotation'],
            })
          }
        >
          ↷
        </button>
        <button
          className={item.orientation === 'auto' ? 'active' : ''}
          title="Automatically choose the orientation that best fills the label"
          onClick={() => onChange({ ...item, orientation: 'auto' })}
        >
          Auto
        </button>
        <button onClick={onCrop}>Crop</button>
        <button
          title="Reset crop"
          onClick={() =>
            onChange({
              ...item,
              crop: { x: 0, y: 0, width: 1, height: 1 },
              cropStatus: 'full page',
            })
          }
        >
          Reset
        </button>
        <button className="danger" title="Delete" onClick={onDelete}>
          ×
        </button>
      </div>
    </article>
  );
}

function CropEditor({
  item,
  onSave,
  onClose,
}: {
  item: LabelItem;
  onSave: (r: Rect) => void;
  onClose: () => void;
}) {
  const [r, setR] = useState(item.crop);
  const imageRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const set = (key: keyof Rect, value: number) =>
    setR((old) => {
      const next = { ...old, [key]: value };
      next.width = Math.min(next.width, 1 - next.x);
      next.height = Math.min(next.height, 1 - next.y);
      return next;
    });
  const point = (event: ReactPointerEvent) => {
    const box = imageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  };
  const startSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = point(event);
    setR({ ...dragStart.current, width: 0.001, height: 0.001 });
  };
  const moveSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const current = point(event);
    const x = Math.min(dragStart.current.x, current.x);
    const y = Math.min(dragStart.current.y, current.y);
    setR({
      x,
      y,
      width: Math.max(0.001, Math.abs(current.x - dragStart.current.x)),
      height: Math.max(0.001, Math.abs(current.y - dragStart.current.y)),
    });
  };
  const endSelection = () => {
    dragStart.current = null;
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal crop-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Adjust crop"
      >
        <div className="modal-head">
          <div>
            <small>MANUAL CROP</small>
            <h2>{pageLabel(item)}</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="crop-layout">
          <div className="crop-stage">
            <div
              ref={imageRef}
              className="crop-image-frame"
              onPointerDown={startSelection}
              onPointerMove={moveSelection}
              onPointerUp={endSelection}
              onPointerCancel={endSelection}
            >
              <img
                src={item.previewUrl}
                alt="Label crop preview"
                draggable={false}
              />
              <div
                className="crop-mask"
                style={{
                  left: pct(r.x),
                  top: pct(r.y),
                  width: pct(r.width),
                  height: pct(r.height),
                }}
              />
            </div>
            <small>
              Drag directly over the label to select its printable area.
            </small>
          </div>
          <div className="crop-controls">
            {(
              [
                ['x', 'Left'],
                ['y', 'Top'],
                ['width', 'Width'],
                ['height', 'Height'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label} <output>{pct(r[key])}</output>
                <input
                  type="range"
                  min="0"
                  max={
                    key === 'x'
                      ? 1 - r.width
                      : key === 'y'
                        ? 1 - r.height
                        : key === 'width'
                          ? 1 - r.x
                          : 1 - r.y
                  }
                  step="0.005"
                  value={r[key]}
                  onChange={(e) => set(key, Number(e.target.value))}
                />
              </label>
            ))}
            <button
              className="secondary"
              onClick={() => setR(item.detectedCrop)}
            >
              Use detected
            </button>
            <button
              className="secondary"
              onClick={() => setR({ x: 0, y: 0, width: 1, height: 1 })}
            >
              Use full page
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(r)}>
            Apply crop
          </button>
        </div>
      </section>
    </div>
  );
}

function CustomBuilder({
  onSave,
  onClose,
}: {
  onSave: (t: SheetTemplate) => void;
  onClose: () => void;
}) {
  const [t, setT] = useState<SheetTemplate>({
    id: crypto.randomUUID(),
    manufacturer: 'Custom',
    name: 'My label sheet',
    products: [],
    aliases: [],
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    labelWidthIn: 4,
    labelHeightIn: 2,
    columns: 2,
    rows: 5,
    marginLeftIn: 0.15625,
    marginTopIn: 0.5,
    pitchXIn: 4.1875,
    pitchYIn: 2,
    custom: true,
  });
  const errors = validateTemplate(t);
  const numberField = (
    key: keyof SheetTemplate,
    label: string,
    step = 0.01,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={t[key] as number}
        onChange={(e) => setT({ ...t, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Custom sheet builder"
      >
        <div className="modal-head">
          <div>
            <small>CUSTOM STOCK</small>
            <h2>Build a precise sheet</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="form-grid">
          <label className="wide">
            Template name
            <input
              value={t.name}
              onChange={(e) => setT({ ...t, name: e.target.value })}
            />
          </label>
          {numberField('pageWidthIn', 'Page width (in)')}
          {numberField('pageHeightIn', 'Page height (in)')}
          {numberField('labelWidthIn', 'Label width (in)')}
          {numberField('labelHeightIn', 'Label height (in)')}
          {numberField('columns', 'Columns', 1)}
          {numberField('rows', 'Rows', 1)}
          {numberField('marginLeftIn', 'Left margin (in)')}
          {numberField('marginTopIn', 'Top margin (in)')}
          {numberField('pitchXIn', 'Horizontal pitch (in)')}
          {numberField('pitchYIn', 'Vertical pitch (in)')}
        </div>
        {errors.length > 0 && (
          <div className="error-box">{errors.join(' ')}</div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!!errors.length || !t.name.trim()}
            onClick={() => onSave(t)}
          >
            Save template
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<LabelItem[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [customTemplates, setCustomTemplates] = useState<SheetTemplate[]>(() =>
    loadJson('k17-custom-templates', []),
  );
  const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];
  const [templateId, setTemplateId] = useState(
    () => localStorage.getItem('k17-template') || 'avery-5126',
  );
  const template =
    allTemplates.find((t) => t.id === templateId) || allTemplates[0];
  const [selectionMode, setSelectionMode] = useState<'used' | 'available'>(
    'used',
  );
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [cropItem, setCropItem] = useState<LabelItem | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrations, setCalibrations] = useState<Calibration[]>(() =>
    loadJson('k17-calibrations', [DEFAULT_CAL]),
  );
  const [calId, setCalId] = useState('none');
  const calibration = calibrations.find((c) => c.id === calId) || DEFAULT_CAL;
  const allSlots = useMemo(
    () => Array.from({ length: template.rows * template.columns }, (_, i) => i),
    [template],
  );
  const unavailable = useMemo(
    () =>
      new Set(
        selectionMode === 'used'
          ? selectedSlots
          : allSlots.filter((i) => !selectedSlots.has(i)),
      ),
    [allSlots, selectedSlots, selectionMode],
  );
  const availableSlots = useMemo(
    () => allSlots.filter((i) => !unavailable.has(i)),
    [allSlots, unavailable],
  );
  const filteredTemplates = allTemplates.filter((t) =>
    templateSearchText(t).includes(query.toLowerCase()),
  );

  const addFiles = async (list: FileList | File[]) => {
    const files = Array.from(list).filter(
      (f) =>
        f.type === 'application/pdf' ||
        /^image\/(png|jpeg)$/.test(f.type) ||
        /\.(pdf|png|jpe?g)$/i.test(f.name),
    );
    if (!files.length) {
      setError('Choose PDF, PNG, or JPEG files.');
      return;
    }
    setBusy(
      `Reading ${files.length} file${files.length === 1 ? '' : 's'} locally…`,
    );
    setError('');
    try {
      const imported = await importFiles(files);
      setItems((old) => [...old, ...imported]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import that file.');
    } finally {
      setBusy('');
    }
  };
  const updateItem = (next: LabelItem) =>
    setItems((old) => old.map((x) => (x.id === next.id ? next : x)));
  const changeTemplate = (id: string) => {
    setTemplateId(id);
    localStorage.setItem('k17-template', id);
    setSelectedSlots(new Set());
  };
  const toggleSlot = (i: number) =>
    setSelectedSlots((old) => {
      const n = new Set(old);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      setItems((old) =>
        arrayMove(
          old,
          old.findIndex((x) => x.id === active.id),
          old.findIndex((x) => x.id === over.id),
        ),
      );
  };
  const createPdf = async () => {
    if (!items.length) {
      setError('Add at least one shipping label first.');
      return;
    }
    setBusy('Building a vector-preserving print PDF…');
    setError('');
    try {
      downloadBytes(
        await generateSheetPdf(items, template, unavailable, calibration),
        `K17-label-sheet-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate PDF.');
    } finally {
      setBusy('');
    }
  };
  const saveCustom = (t: SheetTemplate) => {
    const next = [...customTemplates, t];
    setCustomTemplates(next);
    saveJson('k17-custom-templates', next);
    changeTemplate(t.id);
    setShowCustom(false);
  };
  const saveCalibration = (c: Calibration) => {
    const next = calibrations.some((x) => x.id === c.id)
      ? calibrations.map((x) => (x.id === c.id ? c : x))
      : [...calibrations, c];
    setCalibrations(next);
    saveJson('k17-calibrations', next);
    setCalId(c.id);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">K17</span>
          <div>
            <h1>Label Sheet Tool</h1>
            <p>Shipping labels, placed precisely.</p>
          </div>
        </div>
        <div className="privacy">
          <span>●</span>
          <strong>Private by design</strong>
          <small>Files never leave this browser</small>
        </div>
      </header>
      <main>
        <section className="workflow-head">
          <div>
            <span className="eyebrow">PRINT UTILITY / 01</span>
            <h2>
              Turn shipping files into
              <br />
              <em>ready-to-print sheets.</em>
            </h2>
          </div>
          <p>
            Drop in carrier labels, choose the stock already in your printer,
            and mark the stickers you have left. We handle the geometry.
          </p>
        </section>
        <div className="workspace-grid">
          <section className="panel import-panel">
            <div className="panel-title">
              <div>
                <span className="step">01</span>
                <h3>Import labels</h3>
              </div>
              <span className="count">
                {items.length} ITEM{items.length === 1 ? '' : 'S'}
              </span>
            </div>
            <div
              className={`dropzone ${dragging ? 'active' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                hidden
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                multiple
                onChange={(e) =>
                  e.target.files && void addFiles(e.target.files)
                }
              />
              <div className="drop-icon">↥</div>
              <strong>Drop shipping labels here</strong>
              <span>PDF · MULTI-PAGE PDF · PNG · JPEG</span>
              <button>Browse files</button>
            </div>
            {busy && (
              <div className="status">
                <span className="spinner" />
                {busy}
              </div>
            )}
            {error && <div className="error-box">{error}</div>}
            <DndContext collisionDetection={closestCenter} onDragEnd={dragEnd}>
              <SortableContext
                items={items.map((x) => x.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="label-list">
                  {items.map((item, i) => (
                    <SortableLabel
                      key={item.id}
                      item={item}
                      slot={
                        availableSlots[i % Math.max(1, availableSlots.length)]
                      }
                      onChange={updateItem}
                      onDelete={() =>
                        setItems((old) => old.filter((x) => x.id !== item.id))
                      }
                      onCrop={() => setCropItem(item)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>

          <section className="panel stock-panel">
            <div className="panel-title">
              <div>
                <span className="step">02</span>
                <h3>Choose stock</h3>
              </div>
              <button
                className="text-button"
                onClick={() => setShowCustom(true)}
              >
                + Custom
              </button>
            </div>
            <label className="search">
              <span>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 5126, half sheet, 5.5 × 8.5…"
              />
            </label>
            <div className="template-list">
              {filteredTemplates.map((t) => (
                <button
                  key={t.id}
                  className={`template-option ${t.id === template.id ? 'selected' : ''}`}
                  onClick={() => changeTemplate(t.id)}
                >
                  <span className="mini-sheet">
                    {Array.from({
                      length: Math.min(10, t.rows * t.columns),
                    }).map((_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <span>
                    <strong>
                      {t.manufacturer} {t.products.join(' / ') || t.name}
                    </strong>
                    <small>
                      {t.labelWidthIn.toFixed(2).replace('.00', '')} ×{' '}
                      {t.labelHeightIn.toFixed(2).replace('.00', '')} in ·{' '}
                      {t.rows * t.columns} per Letter sheet
                    </small>
                  </span>
                  <b>{t.id === template.id ? '✓' : ''}</b>
                </button>
              ))}
            </div>
            <div className="stock-details">
              <span>SELECTED GEOMETRY</span>
              <dl>
                <div>
                  <dt>Label</dt>
                  <dd>
                    {template.labelWidthIn.toFixed(3)} ×{' '}
                    {template.labelHeightIn.toFixed(3)} in
                  </dd>
                </div>
                <div>
                  <dt>Grid</dt>
                  <dd>
                    {template.columns} across × {template.rows} down
                  </dd>
                </div>
                <div>
                  <dt>Page</dt>
                  <dd>
                    {template.pageWidthIn} × {template.pageHeightIn} in
                  </dd>
                </div>
              </dl>
              {template.source && (
                <a href={template.source} target="_blank" rel="noreferrer">
                  Verified template source ↗
                </a>
              )}
            </div>
          </section>

          <section className="panel sheet-panel">
            <div className="panel-title">
              <div>
                <span className="step">03</span>
                <h3>Mark sheet positions</h3>
              </div>
              <button
                className="text-button"
                onClick={() => setSelectedSlots(new Set())}
              >
                Clear selection
              </button>
            </div>
            <p className="hint">
              Choose what clicks mean below, then click the matching positions
              on your physical sheet.
            </p>
            <div className="sheet-wrap">
              <div
                className="sheet"
                style={{
                  aspectRatio: `${template.pageWidthIn}/${template.pageHeightIn}`,
                }}
              >
                {Array.from(
                  { length: template.rows * template.columns },
                  (_, i) => {
                    const s = slotRect(template, i);
                    const unavailableHere = unavailable.has(i);
                    const assigned = items[availableSlots.indexOf(i)];
                    const previewRotation = assigned
                      ? resolveRotation(assigned, s.width * 72, s.height * 72)
                      : 0;
                    return (
                      <div
                        key={i}
                        className={`slot ${unavailableHere ? 'used' : assigned ? 'filled' : ''}`}
                        style={{
                          left: pct(s.x / template.pageWidthIn),
                          top: pct(s.y / template.pageHeightIn),
                          width: pct(s.width / template.pageWidthIn),
                          height: pct(s.height / template.pageHeightIn),
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedSlots.has(i)}
                        aria-label={`Slot ${i + 1}: ${unavailableHere ? 'used' : 'available'}`}
                        onClick={() => toggleSlot(i)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleSlot(i);
                          }
                        }}
                      >
                        <span className="slot-num">{i + 1}</span>
                        {assigned ? (
                          <>
                            <CropPreview
                              item={assigned}
                              rotation={previewRotation}
                            />
                            <span className="orientation-note">
                              {assigned.orientation === 'auto'
                                ? `Auto ${previewRotation}°`
                                : `${previewRotation}°`}
                            </span>
                          </>
                        ) : (
                          <span className="slot-state">
                            {unavailableHere ? 'USED' : 'AVAILABLE'}
                          </span>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
            <div className="legend">
              <div className="mode-control">
                <span>Clicks mark used</span>
                <label className="mode-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={selectionMode === 'available'}
                    aria-label="Switch between marking used and available positions"
                    onChange={(event) => {
                      setSelectionMode(
                        event.target.checked ? 'available' : 'used',
                      );
                      setSelectedSlots(new Set());
                    }}
                  />
                  <i aria-hidden="true" />
                </label>
                <span>Clicks mark available</span>
              </div>
              <strong>
                {availableSlots.length} of {template.rows * template.columns}{' '}
                open
              </strong>
            </div>
            <p className="mode-help">
              Default: click labels already used. Switch modes when it is faster
              to click only the labels still available.
            </p>
          </section>
        </div>

        <section className="output-bar">
          <div>
            <span className="step">04</span>
            <div>
              <h3>Generate print-ready PDF</h3>
              <p>
                <strong>Print at 100% / Actual Size.</strong> Disable “Fit to
                page,” “Shrink oversized pages,” or similar scaling.
              </p>
            </div>
          </div>
          <div className="output-actions">
            <label>
              Printer profile
              <select value={calId} onChange={(e) => setCalId(e.target.value)}>
                {calibrations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              onClick={() => setShowCalibration(true)}
            >
              Calibrate
            </button>
            <button
              className="primary download"
              onClick={() => void createPdf()}
              disabled={!items.length || !!busy}
            >
              Download PDF <span>↓</span>
            </button>
          </div>
        </section>
        <section className="privacy-note">
          <strong>LOCAL PROCESSING</strong>
          <p>
            Your labels are processed locally in your browser and are not
            uploaded. No accounts, analytics, OCR services, or document logging.
          </p>
          <span>
            PDF text and barcodes stay vector-sharp whenever the source permits.
          </span>
        </section>
      </main>
      <footer>
        <span>K17 ENGINEERING</span>
        <span>Open-source precision tools · MIT License</span>
        <a
          href="https://github.com/KyleKulhanek/k17-label-sheet"
          target="_blank"
          rel="noreferrer"
        >
          Source ↗
        </a>
      </footer>
      {cropItem && (
        <CropEditor
          item={cropItem}
          onClose={() => setCropItem(null)}
          onSave={(crop) => {
            updateItem({ ...cropItem, crop, cropStatus: 'manual' });
            setCropItem(null);
          }}
        />
      )}
      {showCustom && (
        <CustomBuilder
          onClose={() => setShowCustom(false)}
          onSave={saveCustom}
        />
      )}
      {showCalibration && (
        <CalibrationModal
          current={calibration}
          templates={allTemplates}
          defaultTemplateId={template.id}
          onSave={(c) => {
            saveCalibration(c);
            setShowCalibration(false);
          }}
          onClose={() => setShowCalibration(false)}
        />
      )}
    </div>
  );
}

function CalibrationModal({
  current,
  templates,
  defaultTemplateId,
  onSave,
  onClose,
}: {
  current: Calibration;
  templates: SheetTemplate[];
  defaultTemplateId: string;
  onSave: (c: Calibration) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<'paper' | 'stock'>('paper');
  const [id] = useState(() =>
    current.id === 'none' ? crypto.randomUUID() : current.id,
  );
  const [name, setName] = useState(
    current.id === 'none' ? 'My printer' : current.name,
  );
  const [centerX, setCenterX] = useState(0);
  const [centerY, setCenterY] = useState(0);
  const [spanX, setSpanX] = useState(100);
  const [spanY, setSpanY] = useState(100);
  const [stockId, setStockId] = useState(defaultTemplateId);
  const [marker, setMarker] = useState<'black' | 'yellow'>('yellow');
  const [leftError, setLeftError] = useState(0);
  const [rightError, setRightError] = useState(0);
  const [topError, setTopError] = useState(0);
  const [bottomError, setBottomError] = useState(0);
  const stock = templates.find((t) => t.id === stockId) || templates[0];
  const result =
    method === 'paper'
      ? calibrationFromPlainPaper(id, name, centerX, centerY, spanX, spanY)
      : calibrationFromStock(
          id,
          name,
          stock,
          leftError,
          rightError,
          topError,
          bottomError,
        );
  const measureField = (
    label: string,
    value: number,
    setter: (value: number) => void,
    step = 0.1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => setter(Number(event.target.value))}
      />
    </label>
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal calibration-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Printer calibration"
      >
        <div className="modal-head">
          <div>
            <small>PRINTER PROFILE</small>
            <h2>Correct physical print drift</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="calibration-methods">
          <button
            className={method === 'paper' ? 'selected' : ''}
            onClick={() => setMethod('paper')}
          >
            <strong>Regular paper</strong>
            <span>Measure a center crosshair and two 100 mm rulers.</span>
          </button>
          <button
            className={method === 'stock' ? 'selected' : ''}
            onClick={() => setMethod('stock')}
          >
            <strong>Label sheet</strong>
            <span>Compare printed guides directly with label boundaries.</span>
          </button>
        </div>
        <label className="profile-name">
          Profile name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {method === 'paper' ? (
          <div className="calibration-workflow">
            <ol>
              <li>
                Download and print on regular paper at{' '}
                <strong>100% / Actual Size</strong>.
              </li>
              <li>
                Use calipers, a ruler, or measuring tape to measure the center
                error and the two nominal 100 mm spans.
              </li>
              <li>
                Positive errors mean right or down. Enter what you observe; the
                correction is calculated automatically.
              </li>
            </ol>
            <button
              className="secondary"
              onClick={async () =>
                downloadBytes(
                  await generateCalibrationPdf(),
                  'K17-plain-paper-calibration.pdf',
                )
              }
            >
              Download plain-paper test
            </button>
            <div className="form-grid">
              {measureField(
                'Center horizontal error (mm)',
                centerX,
                setCenterX,
              )}
              {measureField('Center vertical error (mm)', centerY, setCenterY)}
              {measureField('Measured horizontal 100 mm span', spanX, setSpanX)}
              {measureField('Measured vertical 100 mm span', spanY, setSpanY)}
            </div>
          </div>
        ) : (
          <div className="calibration-workflow">
            <div className="form-grid">
              <label>
                Label stock
                <select
                  value={stock.id}
                  onChange={(event) => setStockId(event.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.manufacturer} {t.products.join(' / ') || t.name} —{' '}
                      {t.rows * t.columns} labels
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Marker style
                <select
                  value={marker}
                  onChange={(event) =>
                    setMarker(event.target.value as 'black' | 'yellow')
                  }
                >
                  <option value="yellow">Faint yellow — reusable labels</option>
                  <option value="black">
                    Black and white — highest contrast
                  </option>
                </select>
              </label>
            </div>
            <ol>
              <li>
                Download and print on the selected label stock at{' '}
                <strong>100% / Actual Size</strong>.
              </li>
              <li>
                At the outermost label boundaries, measure where each printed
                guide falls.
              </li>
              <li>
                Enter signed errors: right/down are positive; left/up are
                negative.
              </li>
            </ol>
            <button
              className="secondary"
              onClick={async () =>
                downloadBytes(
                  await generateStockCalibrationPdf(stock, marker),
                  `K17-${stock.id}-calibration.pdf`,
                )
              }
            >
              Download label-sheet test
            </button>
            <div className="form-grid">
              {measureField(
                'Left boundary error (mm)',
                leftError,
                setLeftError,
              )}
              {measureField(
                'Right boundary error (mm)',
                rightError,
                setRightError,
              )}
              {measureField('Top boundary error (mm)', topError, setTopError)}
              {measureField(
                'Bottom boundary error (mm)',
                bottomError,
                setBottomError,
              )}
            </div>
          </div>
        )}
        <div className="calibration-result">
          <strong>Calculated correction</strong>
          <span>
            X {result.offsetXmm.toFixed(2)} mm · Y {result.offsetYmm.toFixed(2)}{' '}
            mm · Scale {result.scaleX.toFixed(4)} × {result.scaleY.toFixed(4)}
          </span>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!name.trim() || spanX <= 0 || spanY <= 0}
            onClick={() => onSave(result)}
          >
            Save profile
          </button>
        </div>
      </section>
    </div>
  );
}
