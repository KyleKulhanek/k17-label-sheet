import { describe, expect, it } from 'vitest';
import { fitRect } from './pdf';

describe('label fit', () => {
  it('contains content without distortion', () => {
    expect(fitRect(4, 6, 4, 2, 0)).toEqual({ width: 4 / 3, height: 2, scale: 1 / 3 });
    expect(fitRect(4, 6, 4, 2, 90)).toEqual({ width: 3, height: 2, scale: 0.5 });
  });
});
