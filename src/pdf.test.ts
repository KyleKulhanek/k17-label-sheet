import { describe, expect, it } from 'vitest';
import { fitRect, resolveRotation } from './pdf';
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
