import type { SheetTemplate } from './types';

// Dimensions are inches. Product sizes and aliases are verified against Avery's
// official template catalog; pitches/margins reproduce the corresponding Letter layouts.
export const BUILTIN_TEMPLATES: SheetTemplate[] = [
  {
    id: 'avery-5126',
    manufacturer: 'Avery',
    name: 'Half-sheet shipping labels',
    products: ['5126', '8126'],
    aliases: ['half sheet', '5.5 x 8.5', '5½ × 8½', '5526', '15516', '18126'],
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    labelWidthIn: 8.5,
    labelHeightIn: 5.5,
    columns: 1,
    rows: 2,
    marginLeftIn: 0,
    marginTopIn: 0,
    pitchXIn: 8.5,
    pitchYIn: 5.5,
    source: 'https://www.avery.com/templates/5126',
  },
  {
    id: 'avery-5163',
    manufacturer: 'Avery',
    name: 'Shipping labels',
    products: ['5163', '8163'],
    aliases: ['2 x 4', '2×4', '10 per sheet', '5263', '8463'],
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
    source: 'https://www.avery.com/templates/5163',
  },
  {
    id: 'avery-5164',
    manufacturer: 'Avery',
    name: 'Large shipping labels',
    products: ['5164', '8164'],
    aliases: ['3 1/3 x 4', '3⅓ × 4', '6 per sheet', '5264', '8464'],
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    labelWidthIn: 4,
    labelHeightIn: 10 / 3,
    columns: 2,
    rows: 3,
    marginLeftIn: 0.15625,
    marginTopIn: 0.5,
    pitchXIn: 4.1875,
    pitchYIn: 10 / 3,
    source: 'https://www.avery.com/templates/5164',
  },
  {
    id: 'avery-5168',
    manufacturer: 'Avery',
    name: 'Oversized shipping labels',
    products: ['5168', '8168'],
    aliases: ['3.5 x 5', '3½ × 5', '4 per sheet', '27950', '95935'],
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    labelWidthIn: 3.5,
    labelHeightIn: 5,
    columns: 2,
    rows: 2,
    marginLeftIn: 0.5,
    marginTopIn: 0.5,
    pitchXIn: 4,
    pitchYIn: 5,
    source: 'https://www.avery.com/templates/5168',
  },
];

export const slotRect = (t: SheetTemplate, index: number) => ({
  x: t.marginLeftIn + (index % t.columns) * t.pitchXIn,
  y: t.marginTopIn + Math.floor(index / t.columns) * t.pitchYIn,
  width: t.labelWidthIn,
  height: t.labelHeightIn,
});

export function validateTemplate(t: SheetTemplate): string[] {
  const errors: string[] = [];
  const right = t.marginLeftIn + (t.columns - 1) * t.pitchXIn + t.labelWidthIn;
  const bottom = t.marginTopIn + (t.rows - 1) * t.pitchYIn + t.labelHeightIn;
  if (
    [
      t.pageWidthIn,
      t.pageHeightIn,
      t.labelWidthIn,
      t.labelHeightIn,
      t.columns,
      t.rows,
    ].some((v) => !Number.isFinite(v) || v <= 0)
  )
    errors.push('All dimensions and counts must be positive.');
  if (t.pitchXIn < t.labelWidthIn || t.pitchYIn < t.labelHeightIn)
    errors.push('Pitch cannot be smaller than label size.');
  if (right > t.pageWidthIn + 0.001 || bottom > t.pageHeightIn + 0.001)
    errors.push('The label grid extends beyond the page.');
  return errors;
}

export const templateSearchText = (t: SheetTemplate) =>
  [
    t.manufacturer,
    t.name,
    ...t.products,
    ...t.aliases,
    `${t.labelWidthIn} x ${t.labelHeightIn}`,
    `${t.rows * t.columns} per sheet`,
  ]
    .join(' ')
    .toLowerCase();
