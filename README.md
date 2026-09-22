# Change Order Generator

GitHub Pages-ready, client-side Change Order generator for Renewal by Andersen GLA.

## Repository name

Use exactly:

`changeorder`

Expected GitHub Pages URL:

`https://rbc281.github.io/changeorder/`

## Upload these files to the repository root

- `index.html` - rep-facing form
- `styles.css` - iPad/mobile-first styling
- `app.js` - validation, PAF payment calculations, signatures, high-resolution canvas rendering, preview, and fresh PDF generation
- `change-order-template.png` - 2550 x 3300 (300 DPI Letter-size) visual master used for both preview and PDF output
- `change-order-template.pdf` - retained legacy reference only; generated documents do not load, modify, or resave it
- `blank-change-order-fillable.pdf` - untouched original fillable Change Order form used by the Blank Change Order download link
- `manifest.webmanifest` / `sw.js` - PWA shell and offline fallback for same-origin app files after the first successful load

## Publish on GitHub Pages

1. Create or clear the public repository named `changeorder`.
2. Upload **all files from this package directly to the repository root**. Do not upload the ZIP itself.
3. In GitHub, open **Settings > Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`, then Save.
6. Wait for GitHub Pages to deploy.
7. Because earlier test versions used a cache-first service worker, open this version once with a cache-busting URL: `https://rbc281.github.io/changeorder/?v=20260922v3`. After that first successful load, the normal URL will work: `https://rbc281.github.io/changeorder/`.

## Key behavior

- Customer/order data is processed locally in the browser. The app does not send entered customer data to a server.
- The generator renders the exact Change Order visual template and entered data to a 2550 x 3300 canvas. The large preview and downloaded PDF use that same rendered canvas, so they are WYSIWYG.
- Download PDF creates a brand-new one-page Letter-size PDF containing the rendered image. It never loads or resaves either source PDF, eliminating inherited AcroForm, annotation, xref, or appearance-stream problems.
- The original fillable Change Order is preserved separately as `blank-change-order-fillable.pdf` for reps who need a blank form.
- The form accepts at most five project-change line items and does not auto-download after review.
- Customer 2 and customer signatures are optional. Management signature remains blank on generated PDFs.
- Out-of-pocket may be left blank when the project is fully financed; blank is treated as $0 out of pocket.
- Finance Program becomes required whenever any amount is financed. The human-readable plan is printed on the Finance Program line and its code is printed on Finance Plan #.
- Payment schedule logic mirrors the current PAF Calculator: deposit is capped at the lesser of 10% or $1,000; 33% is due through the progress stage; the remaining balance is due at installation; out-of-pocket funds are applied first at each stage.
- The PDF library is loaded from the pinned `pdf-lib` 1.17.1 CDN URL in `index.html`, so an internet connection is required when that library is not already cached by the browser.
- The service worker uses a network-first strategy for repository files so future GitHub updates are less likely to be hidden by an old cache.

## Finance programs

- S100617 - 6 Months - No Payments / No Interest
- S101217 - 12 Months - No Payments / No Interest
- R412006 - 6.99% - 10 Years
- R412009 - 9.99% - 10 Years
- R418006 - 6.99% - 15 Years
- R418009 - 9.99% - 15 Years

