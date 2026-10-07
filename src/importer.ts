import * as pdfjs from 'pdfjs-dist';
import type { LabelItem, Rect } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const recognizedPage = (w: number, h: number) => {
  const inches = [
    [w / 72, h / 72],
    [h / 72, w / 72],
  ];
  return inches.some(
    ([a, b]) =>
      (Math.abs(a - 4) < 0.12 && Math.abs(b - 6) < 0.12) ||
      (Math.abs(a - 100 / 25.4) < 0.12 && Math.abs(b - 150 / 25.4) < 0.12),
  );
};

export function contentBounds(
  ctx: Pick<CanvasRenderingContext2D, 'getImageData'>,
  width: number,
  height: number,
): Rect | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  const columnInk = new Uint32Array(width);
  const rowInk = new Uint32Array(height);
  const step = 2;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] / 255;
      const visibleAverage =
        ((data[i] + data[i + 1] + data[i + 2]) / 3) * alpha + 255 * (1 - alpha);
      if (255 - visibleAverage > 28) {
        columnInk[x]++;
        rowInk[y]++;
      }
    }
  }
  // Projection thresholds reject sparse screenshot chrome, isolated specks, and
  // antialiasing while retaining text, borders, and barcode runs.
  const columnThreshold = Math.max(2, Math.floor((height / step) * 0.02));
  const rowThreshold = Math.max(2, Math.floor((width / step) * 0.02));
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let x = 0; x < width; x += step)
    if (columnInk[x] >= columnThreshold) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  for (let y = 0; y < height; y += step)
    if (rowInk[y] >= rowThreshold) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (maxX < 0) return null;
  const padX = Math.max(8, (maxX - minX) * 0.035);
  const padY = Math.max(8, (maxY - minY) * 0.035);
  return {
    x: Math.max(0, minX - padX) / width,
    y: Math.max(0, minY - padY) / height,
    width: (Math.min(width, maxX + padX) - Math.max(0, minX - padX)) / width,
    height: (Math.min(height, maxY + padY) - Math.max(0, minY - padY)) / height,
  };
}

async function renderPage(page: any) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1100 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, viewport };
}

export async function importFiles(files: File[]): Promise<LabelItem[]> {
  const items: LabelItem[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      const doc = await pdfjs.getDocument({
        data: bytes.slice(),
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
      }).promise;
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
        const page = await doc.getPage(pageIndex + 1);
        const viewport72 = page.getViewport({ scale: 1 });
        const { canvas, ctx } = await renderPage(page);
        const whole = recognizedPage(viewport72.width, viewport72.height);
        const candidate = whole
          ? null
          : contentBounds(ctx, canvas.width, canvas.height);
        const useful =
          candidate &&
          candidate.width * candidate.height < 0.83 &&
          candidate.width > 0.25 &&
          candidate.height > 0.25;
        const crop = useful ? candidate : { x: 0, y: 0, width: 1, height: 1 };
        items.push({
          id: crypto.randomUUID(),
          filename: file.name,
          kind: 'pdf',
          mime: 'application/pdf',
          bytes,
          pageIndex,
          pageCount: doc.numPages,
          widthPt: viewport72.width,
          heightPt: viewport72.height,
          previewUrl: canvas.toDataURL('image/jpeg', 0.82),
          crop,
          detectedCrop: { ...crop },
          cropStatus: useful ? 'auto' : 'full page',
          rotation: 0,
          orientation: 'auto',
        });
      }
      await doc.destroy();
    } else if (
      /^image\/(png|jpeg)$/.test(file.type) ||
      /\.(png|jpe?g)$/i.test(file.name)
    ) {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const canvas = document.createElement('canvas');
      const analysisScale = Math.min(
        1,
        1100 / Math.max(img.naturalWidth, img.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(img.naturalWidth * analysisScale));
      canvas.height = Math.max(
        1,
        Math.round(img.naturalHeight * analysisScale),
      );
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const candidate = contentBounds(ctx, canvas.width, canvas.height);
      const useful =
        candidate &&
        candidate.width * candidate.height < 0.83 &&
        candidate.width > 0.25 &&
        candidate.height > 0.25;
      const crop = useful ? candidate : { x: 0, y: 0, width: 1, height: 1 };
      items.push({
        id: crypto.randomUUID(),
        filename: file.name,
        kind: 'image',
        mime:
          file.type ||
          (file.name.toLowerCase().endsWith('.png')
            ? 'image/png'
            : 'image/jpeg'),
        bytes,
        pageIndex: 0,
        pageCount: 1,
        widthPt: img.naturalWidth,
        heightPt: img.naturalHeight,
        previewUrl: url,
        crop,
        detectedCrop: { ...crop },
        cropStatus: useful ? 'auto' : 'full page',
        rotation: 0,
        orientation: 'auto',
      });
    }
  }
  return items;
}
