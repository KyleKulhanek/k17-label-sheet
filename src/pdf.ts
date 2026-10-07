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
      const boxX = s.x * PT + calibration.offsetXmm * MM;
      const boxY =
        (template.pageHeightIn - s.y - s.height) * PT -
        calibration.offsetYmm * MM;
      const x = boxX + (s.width * PT - fit.width) / 2;
      const y = boxY + (s.height * PT - fit.height) / 2;
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
  p.drawText('K17 printer calibration — print at 100% / Actual Size', {
    x: 30,
    y: pageHeightIn * PT - 48,
    size: 14,
    color: dark,
  });
  p.drawText(
    'Measure the crosshair shift from page center in millimeters, then enter X and Y offsets in the app.',
    { x: 30, y: pageHeightIn * PT - 66, size: 8, color: dark },
  );
  p.drawText('The outer reference is 1/4 inch from each PDF page edge.', {
    x: 30,
    y: 30,
    size: 8,
    color: dark,
  });
  return doc.save();
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
