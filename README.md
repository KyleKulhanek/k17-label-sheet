# K17 Label Sheet Tool

A privacy-first React/TypeScript utility that turns shipping-label PDFs and
images into dimensionally accurate commercial label-sheet PDFs.

Production: <https://labels.k17engineering.com>

## What it does

- Imports PDF, multi-page PDF, PNG, and JPEG files in the browser.
- Treats each PDF page as an independent label.
- Recognizes 4 × 6 inch and 100 × 150 mm label pages and performs conservative
  content-bound crop detection for larger pages.
- Provides visual manual cropping, rotation, deletion, and drag reordering.
- Marks used/available physical stickers on a reusable sheet.
- Includes verified Avery 5126/8126, 5163/8163, 5164/8164, and 5168/8168
  families, searchable aliases, and a validated custom-sheet builder.
- Preserves PDF vector content with `pdf-lib`; only previews and crop analysis
  are rasterized. Raster inputs remain raster inputs.
- Generates named local printer calibrations and a measurement test page.
- Stores only template preferences and calibration settings in local storage.
  Source documents stay in memory and are never uploaded.

## Development

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
```

The production bundle is a static site under `dist/`. There are no API routes,
accounts, analytics, or backend document processing.

## Template data

Templates live in `src/templates.ts`. Geometry uses inches and consists of page
size, label size, grid counts, first-label margins, and horizontal/vertical
pitch. `validateTemplate` rejects non-positive, overlapping, or out-of-page
grids. Additions should cite a manufacturer source and receive a geometry test.

Initial product families were checked against Avery's official catalog:

- <https://www.avery.com/templates/5126>
- <https://www.avery.com/templates/5163>
- <https://www.avery.com/templates/5164>
- <https://www.avery.com/templates/5168>

Product names and numbers belong to their respective owners. K17 Engineering
is not affiliated with or endorsed by Avery Products Corporation.

## Printing

Generated PDFs use physical PDF points (72 points per inch). Print with
**100% / Actual Size** and disable “Fit to page,” “Shrink oversized pages,” or
similar scaling. Printer feed drift is hardware-specific and can be corrected
with a saved calibration profile.

## License

MIT — see [LICENSE](LICENSE).
