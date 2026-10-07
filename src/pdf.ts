import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { Calibration, LabelItem, SheetTemplate } from './types';
import { slotRect } from './templates';

const PT = 72;
const MM = PT / 25.4;

async function croppedRaster(item: LabelItem): Promise<Uint8Array> {
  if (
    item.crop.x === 0 &&
    item.crop.y === 0 &&
    item.crop.width === 1 &&
    item.crop.height === 1
  )
    return item.bytes;
  const blob = new Blob([item.bytes as BlobPart], { type: item.mime });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * item.crop.width));
  canvas.height = Math.max(1, Math.round(bitmap.height * item.crop.height));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    bitmap,
    item.crop.x * bitmap.width,
    item.crop.y * bitmap.height,
    item.crop.width * bitmap.width,
    item.crop.height * bitmap.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  const cropped = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error('Could not crop image.')),
      'image/png',
    ),
  );
  return new Uint8Array(await cropped.arrayBuffer());
}

export function fitRect(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
  rotation: number,
) {
  const rotated = rotation % 180 !== 0;
  const w = rotated ? sourceH : sourceW;
  const h = rotated ? sourceW : sourceH;
  const scale = Math.min(targetW / w, targetH / h);
  return { width: w * scale, height: h * scale, scale };
}

export const resolveRotation = (
  item: LabelItem,
  slotW: number,
  slotH: number,
) => {
  if (item.orientation === 'manual') return item.rotation;
  const cropW = item.widthPt * item.crop.width;
  const cropH = item.heightPt * item.crop.height;
  const current = fitRect(cropW, cropH, slotW, slotH, item.rotation);
  const turned = fitRect(
    cropW,
    cropH,
    slotW,
    slotH,
    (item.rotation + 90) % 360,
  );
  return turned.width * turned.height > current.width * current.height * 1.04
    ? (((item.rotation + 90) % 360) as 0 | 90 | 180 | 270)
    : item.rotation;
};

export async function generateSheetPdf(
  items: LabelItem[],
  template: SheetTemplate,
  unavailable: Set<number>,
  calibration: Calibration,
  drawGuides = false,
) {
  const out = await PDFDocument.create();
  const slots = Array.from(
    { length: template.rows * template.columns },
    (_, i) => i,
  ).filter((i) => !unavailable.has(i));
  if (!slots.length)
    throw new Error('Mark at least one sheet position as available.');
  const pdfCache = new Map<string, PDFDocument>();
  const pageWidthPt = template.pageWidthIn * PT;
  const pageHeightPt = template.pageHeightIn * PT;
  for (
    let offset = 0;
    offset < items.length || offset === 0;
    offset += slots.length
  ) {
    const page = out.addPage([
      template.pageWidthIn * PT,
      template.pageHeightIn * PT,
    ]);
    const pageItems = items.slice(offset, offset + slots.length);
    for (let j = 0; j < pageItems.length; j++) {
      const item = pageItems[j];
      const s = slotRect(template, slots[j]);
      const targetW = s.width * PT * calibration.scaleX;
      const targetH = s.height * PT * calibration.scaleY;
      const rotation = resolveRotation(item, targetW, targetH);
      const cropW = item.widthPt * item.crop.width;
      const cropH = item.heightPt * item.crop.height;
      const fit = fitRect(cropW, cropH, targetW, targetH, rotation);
      const boxX =
        pageWidthPt / 2 +
        (s.x * PT - pageWidthPt / 2) * calibration.scaleX +
        calibration.offsetXmm * MM;
      const boxTop =
        pageHeightPt / 2 +
        (s.y * PT - pageHeightPt / 2) * calibration.scaleY +
        calibration.offsetYmm * MM;
      const boxY = pageHeightPt - boxTop - targetH;
      const x = boxX + (targetW - fit.width) / 2;
      const y = boxY + (targetH - fit.height) / 2;
      if (item.kind === 'pdf') {
        let src = pdfCache.get(item.filename);
        if (!src) {
          src = await PDFDocument.load(item.bytes);
          pdfCache.set(item.filename, src);
        }
        const sourcePage = src.getPage(item.pageIndex);
        const box = {
          left: item.crop.x * item.widthPt,
          bottom: (1 - item.crop.y - item.crop.height) * item.heightPt,
          right: (item.crop.x + item.crop.width) * item.widthPt,
          top: (1 - item.crop.y) * item.heightPt,
        };
        const embedded = await out.embedPage(sourcePage, box);
        const scale = fit.scale;
        if (rotation === 0)
          page.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
        else if (rotation === 90)
          page.drawPage(embedded, {
            x: x + fit.width,
            y,
            xScale: scale,
            yScale: scale,
            rotate: degrees(90),
          });
        else if (rotation === 180)
          page.drawPage(embedded, {
            x: x + fit.width,
            y: y + fit.height,
            xScale: scale,
            yScale: scale,
            rotate: degrees(180),
          });
        else
          page.drawPage(embedded, {
            x,
            y: y + fit.height,
            xScale: scale,
            yScale: scale,
            rotate: degrees(270),
          });
      } else {
        const cropped = await croppedRaster(item);
        const embedded =
          cropped === item.bytes && item.mime !== 'image/png'
            ? await out.embedJpg(cropped)
            : await out.embedPng(cropped);
        const sourceW = cropW * fit.scale;
        const sourceH = cropH * fit.scale;
        if (rotation === 0)
          page.drawImage(embedded, { x, y, width: sourceW, height: sourceH });
        else if (rotation === 90)
          page.drawImage(embedded, {
            x: x + fit.width,
            y,
            width: sourceW,
            height: sourceH,
            rotate: degrees(90),
          });
        else if (rotation === 180)
          page.drawImage(embedded, {
            x: x + fit.width,
            y: y + fit.height,
            width: sourceW,
            height: sourceH,
            rotate: degrees(180),
          });
        else
          page.drawImage(embedded, {
            x,
            y: y + fit.height,
            width: sourceW,
            height: sourceH,
            rotate: degrees(270),
          });
      }
    }
    if (drawGuides) {
      for (const i of slots) {
        const s = slotRect(template, i);
        page.drawRectangle({
          x: s.x * PT,
          y: (template.pageHeightIn - s.y - s.height) * PT,
          width: s.width * PT,
          height: s.height * PT,
          borderColor: rgb(0.15, 0.55, 0.35),
          borderWidth: 0.5,
          opacity: 0.5,
        });
      }
    }
  }
  return out.save();
}

export async function generateCalibrationPdf(
  pageWidthIn = 8.5,
  pageHeightIn = 11,
) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([pageWidthIn * PT, pageHeightIn * PT]);
  const dark = rgb(0.08, 0.12, 0.09),
    green = rgb(0.1, 0.55, 0.3);
  p.drawRectangle({
    x: 18,
    y: 18,
    width: pageWidthIn * PT - 36,
    height: pageHeightIn * PT - 36,
    borderColor: dark,
    borderWidth: 0.75,
  });
  const cx = (pageWidthIn * PT) / 2,
    cy = (pageHeightIn * PT) / 2;
  p.drawLine({
    start: { x: cx - 36, y: cy },
    end: { x: cx + 36, y: cy },
    color: green,
    thickness: 0.75,
  });
  p.drawLine({
    start: { x: cx, y: cy - 36 },
    end: { x: cx, y: cy + 36 },
    color: green,
    thickness: 0.75,
  });
  for (let mm = -80; mm <= 80; mm += 5) {
    const x = cx + mm * MM;
    p.drawLine({
      start: { x, y: cy - (mm % 10 === 0 ? 10 : 5) },
      end: { x, y: cy + (mm % 10 === 0 ? 10 : 5) },
      color: dark,
      thickness: 0.4,
    });
    const y = cy + mm * MM;
    p.drawLine({
      start: { x: cx - (mm % 10 === 0 ? 10 : 5), y },
      end: { x: cx + (mm % 10 === 0 ? 10 : 5), y },
      color: dark,
      thickness: 0.4,
    });
  }
  const halfSpan = 50 * MM;
  p.drawLine({
    start: { x: cx - halfSpan, y: cy },
    end: { x: cx + halfSpan, y: cy },
    color: green,
    thickness: 1.2,
  });
  p.drawLine({
    start: { x: cx, y: cy - halfSpan },
    end: { x: cx, y: cy + halfSpan },
    color: green,
    thickness: 1.2,
  });
  for (const x of [cx - halfSpan, cx + halfSpan])
    p.drawLine({
      start: { x, y: cy - 12 },
      end: { x, y: cy + 12 },
      color: green,
      thickness: 1.2,
    });
  for (const y of [cy - halfSpan, cy + halfSpan])
    p.drawLine({
      start: { x: cx - 12, y },
      end: { x: cx + 12, y },
      color: green,
      thickness: 1.2,
    });
  p.drawText('K17 printer calibration — print at 100% / Actual Size', {
    x: 30,
    y: pageHeightIn * PT - 48,
    size: 14,
    color: dark,
  });
  p.drawText(
    'Record the signed center error in millimeters: right and down are positive.',
    { x: 30, y: pageHeightIn * PT - 66, size: 8, color: dark },
  );
  p.drawText('Green end marks are exactly 100 mm apart.', {
    x: cx - 78,
    y: cy + 16,
    size: 8,
    color: green,
  });
  p.drawText('The outer reference is 1/4 inch from each PDF page edge.', {
    x: 30,
    y: 30,
    size: 8,
    color: dark,
  });
  return doc.save();
}

export async function generateStockCalibrationPdf(
  template: SheetTemplate,
  marker: 'black' | 'yellow',
) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([
    template.pageWidthIn * PT,
    template.pageHeightIn * PT,
  ]);
  const color =
    marker === 'yellow' ? rgb(0.95, 0.78, 0.08) : rgb(0.08, 0.1, 0.08);
  const opacity = marker === 'yellow' ? 0.42 : 0.9;
  const lineWidth = marker === 'yellow' ? 0.45 : 0.7;
  for (let i = 0; i < template.rows * template.columns; i++) {
    const s = slotRect(template, i);
    const x = s.x * PT;
    const y = (template.pageHeightIn - s.y - s.height) * PT;
    const w = s.width * PT;
    const h = s.height * PT;
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: color,
      borderWidth: lineWidth,
      opacity,
    });
    const tick = Math.min(12, w / 8, h / 8);
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (const edgeY of [y, y + h]) {
      page.drawLine({
        start: { x: cx - tick, y: edgeY },
        end: { x: cx + tick, y: edgeY },
        color,
        thickness: lineWidth,
        opacity,
      });
      page.drawLine({
        start: { x: cx, y: edgeY - tick },
        end: { x: cx, y: edgeY + tick },
        color,
        thickness: lineWidth,
        opacity,
      });
    }
    for (const edgeX of [x, x + w]) {
      page.drawLine({
        start: { x: edgeX, y: cy - tick },
        end: { x: edgeX, y: cy + tick },
        color,
        thickness: lineWidth,
        opacity,
      });
      page.drawLine({
        start: { x: edgeX - tick, y: cy },
        end: { x: edgeX + tick, y: cy },
        color,
        thickness: lineWidth,
        opacity,
      });
    }
  }
  return doc.save();
}

export function calibrationFromPlainPaper(
  id: string,
  name: string,
  centerErrorXmm: number,
  centerErrorYmm: number,
  observedSpanXmm: number,
  observedSpanYmm: number,
): Calibration {
  const scaleX = observedSpanXmm > 0 ? 100 / observedSpanXmm : 1;
  const scaleY = observedSpanYmm > 0 ? 100 / observedSpanYmm : 1;
  return {
    id,
    name,
    offsetXmm: -centerErrorXmm * scaleX,
    offsetYmm: -centerErrorYmm * scaleY,
    scaleX,
    scaleY,
  };
}

function axisCorrection(
  firstMm: number,
  lastMm: number,
  pageCenterMm: number,
  firstErrorMm: number,
  lastErrorMm: number,
) {
  const span = lastMm - firstMm;
  const printerScale = 1 + (lastErrorMm - firstErrorMm) / span;
  const scale = printerScale > 0 ? 1 / printerScale : 1;
  const printerOffset = firstErrorMm - (printerScale - 1) * firstMm;
  const offset = -printerOffset * scale - pageCenterMm * (1 - scale);
  return { scale, offset };
}

export function calibrationFromStock(
  id: string,
  name: string,
  template: SheetTemplate,
  leftErrorMm: number,
  rightErrorMm: number,
  topErrorMm: number,
  bottomErrorMm: number,
): Calibration {
  const first = slotRect(template, 0);
  const last = slotRect(template, template.rows * template.columns - 1);
  const x = axisCorrection(
    first.x * 25.4,
    (last.x + last.width) * 25.4,
    (template.pageWidthIn * 25.4) / 2,
    leftErrorMm,
    rightErrorMm,
  );
  const y = axisCorrection(
    first.y * 25.4,
    (last.y + last.height) * 25.4,
    (template.pageHeightIn * 25.4) / 2,
    topErrorMm,
    bottomErrorMm,
  );
  return {
    id,
    name,
    offsetXmm: x.offset,
    offsetYmm: y.offset,
    scaleX: x.scale,
    scaleY: y.scale,
  };
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
