export type Rect = { x: number; y: number; width: number; height: number };

export type SheetTemplate = {
  id: string;
  manufacturer: string;
  name: string;
  products: string[];
  aliases: string[];
  pageWidthIn: number;
  pageHeightIn: number;
  labelWidthIn: number;
  labelHeightIn: number;
  columns: number;
  rows: number;
  marginLeftIn: number;
  marginTopIn: number;
  pitchXIn: number;
  pitchYIn: number;
  source?: string;
  custom?: boolean;
};

export type LabelItem = {
  id: string;
  filename: string;
  kind: 'pdf' | 'image';
  mime: string;
  bytes: Uint8Array;
  pageIndex: number;
  pageCount: number;
  widthPt: number;
  heightPt: number;
  previewUrl: string;
  crop: Rect;
  detectedCrop: Rect;
  cropStatus: 'full page' | 'auto' | 'manual';
  rotation: 0 | 90 | 180 | 270;
  orientation: 'auto' | 'manual';
};

export type Calibration = {
  id: string;
  name: string;
  offsetXmm: number;
  offsetYmm: number;
  scaleX: number;
  scaleY: number;
};
