import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, slotRect, validateTemplate } from './templates';

describe('sheet geometry', () => {
  it('keeps every built-in slot inside its physical page', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(validateTemplate(t)).toEqual([]);
      for (let i = 0; i < t.columns * t.rows; i++) {
        const r = slotRect(t, i);
        expect(r.x + r.width).toBeLessThanOrEqual(t.pageWidthIn + 1e-6);
        expect(r.y + r.height).toBeLessThanOrEqual(t.pageHeightIn + 1e-6);
      }
    }
  });

  it('models 5126 as two edge-to-edge half sheets', () => {
    const t = BUILTIN_TEMPLATES[0];
    expect(slotRect(t, 1)).toEqual({ x: 0, y: 5.5, width: 8.5, height: 5.5 });
  });
});
