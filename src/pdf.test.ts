import { describe, expect, it } from 'vitest';
import {
  calibrationFromPlainPaper,
  calibrationFromStock,
  fitRect,
  resolveRotation,
} from './pdf';
import { BUILTIN_TEMPLATES } from './templates';
import type { LabelItem } from './types';

describe('label fit', () => {
  it('contains content without distortion', () => {
    expect(fitRect(4, 6, 4, 2, 0)).toEqual({
      width: 4 / 3,
      height: 2,
      scale: 1 / 3,
    });
    expect(fitRect(4, 6, 4, 2, 90)).toEqual({
      width: 3,
      height: 2,
      scale: 0.5,
    });
  });

  it('automatically turns a portrait 4 × 6 label sideways on a half sheet', () => {
    const item = {
      widthPt: 4 * 72,
      heightPt: 6 * 72,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0,
      orientation: 'auto',
    } as LabelItem;
    expect(resolveRotation(item, 8.5 * 72, 5.5 * 72)).toBe(90);
    expect(
      resolveRotation({ ...item, orientation: 'manual' }, 8.5 * 72, 5.5 * 72),
    ).toBe(0);
  });
});

describe('calibration calculations', () => {
  it('converts observed plain-paper errors into inverse corrections', () => {
    const c = calibrationFromPlainPaper('id', 'Printer', 2, -1, 102, 98);
    expect(c.scaleX).toBeCloseTo(100 / 102, 6);
    expect(c.scaleY).toBeCloseTo(100 / 98, 6);
    expect(c.offsetXmm).toBeCloseTo(-2 * (100 / 102), 6);
    expect(c.offsetYmm).toBeCloseTo(100 / 98, 6);
  });

  it('corrects a uniform label-sheet boundary shift without changing scale', () => {
    const c = calibrationFromStock(
      'id',
      'Printer',
      BUILTIN_TEMPLATES[0],
      2,
      2,
      3,
      3,
    );
    expect(c.scaleX).toBeCloseTo(1, 6);
    expect(c.scaleY).toBeCloseTo(1, 6);
    expect(c.offsetXmm).toBeCloseTo(-2, 6);
    expect(c.offsetYmm).toBeCloseTo(-3, 6);
  });
});
