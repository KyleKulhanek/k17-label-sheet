import { describe, expect, it } from 'vitest';
import { contentBounds } from './importer';

describe('automatic crop detection', () => {
  it('finds a dark label centered on a white page', () => {
    const width = 200;
    const height = 200;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 40; y < 160; y++) {
      for (let x = 30; x < 170; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    const ctx = { getImageData: () => ({ data }) } as unknown as Pick<
      CanvasRenderingContext2D,
      'getImageData'
    >;
    const crop = contentBounds(ctx, width, height);
    expect(crop).not.toBeNull();
    expect(crop!.x).toBeGreaterThan(0.08);
    expect(crop!.y).toBeGreaterThan(0.08);
    expect(crop!.width).toBeLessThan(0.85);
    expect(crop!.height).toBeLessThan(0.75);
  });

  it('treats transparent screenshot padding as printable white space', () => {
    const width = 200;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 70; x < 190; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = x % 20 < 4 ? 0 : 255;
        data[i + 3] = 255;
      }
    }
    const ctx = { getImageData: () => ({ data }) } as unknown as Pick<
      CanvasRenderingContext2D,
      'getImageData'
    >;
    const crop = contentBounds(ctx, width, height);
    expect(crop).not.toBeNull();
    expect(crop!.x).toBeGreaterThan(0.25);
    expect(crop!.width).toBeLessThan(0.75);
  });
});
