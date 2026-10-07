# K17 Label Sheet Tool

A privacy-first React/TypeScript utility that turns shipping-label PDFs and
images into dimensionally accurate commercial label-sheet PDFs.

LAN deployment: <https://labels.k17engineering.com>

The hosted application is intentionally available only on the K17 local
network. Its source remains public and open source, but public DNS does not
publish an address for the hosted application.

## What it does

- Imports PDF, multi-page PDF, PNG, and JPEG files in the browser.
- Treats each PDF page as an independent label.
- Recognizes 4 × 6 inch and 100 × 150 mm label pages and performs conservative
  content-bound crop detection for larger pages.
- Automatically detects printable content in PDFs and images, with a direct
  drag-to-select manual crop editor and cropped live previews.
- Automatically rotates portrait labels when that fills a landscape stock
  position better, while retaining explicit manual rotation controls.
- Scales labels up or down proportionally to fit the selected stock without
  distortion.
- Uses one global Used/Available selection mode: by default click the positions
  already used, or switch modes and click only the positions still available.
- Includes verified Avery 5126/8126, 5163/8163, 5164/8164, and 5168/8168
  families, searchable aliases, and a validated custom-sheet builder.
- Preserves PDF vector content with `pdf-lib`; only previews and crop analysis
  are rasterized. Raster inputs remain raster inputs.
- Generates named local printer profiles from either a regular-paper crosshair
  and 100 mm ruler test or stock-specific label-boundary guides. Label-sheet
  tests support high-contrast black or faint yellow reusable markers and print
  four numbered millimeter rulers whose boundary readings feed the calculator.
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

The internal deployment uses `ops/labels.caddy` on the LAN Caddy host and the
OPNsense Unbound host override described by `ops/add_labels_dns.php`. Caddy's
DNS-01 ACME configuration provides trusted HTTPS without a public A or CNAME
record. Requests that do not originate from a private network are rejected.

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
