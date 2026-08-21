# Change Order Generator

GitHub Pages-ready, client-side Change Order generator for Renewal by Andersen GLA.

## Repository name

Use exactly:

`changeorder`

That will publish at:

`https://rbc281.github.io/changeorder/`

## Files

- `index.html` - rep-facing form
- `styles.css` - iPad/mobile-first styling
- `app.js` - validation, PAF calculations, signatures, PDF generation
- `assets/change-order-template.pdf` - original 2026 Change Order form used as the PDF template
- `manifest.webmanifest` / `sw.js` - home-screen/offline support after first load

## Publish on GitHub Pages

1. Create a public repository named `changeorder`.
2. Upload all files and folders from this package to the repository root.
3. In GitHub, open **Settings > Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`, then Save.
6. Wait for GitHub Pages to finish deploying.
7. Open `https://rbc281.github.io/changeorder/`.

## Important implementation notes

- All customer/order data is processed in the browser. The app does not send the entered data to a server.
- The original Change Order PDF remains the template and keeps its printed language unchanged.
- Customer signatures are optional. Management signature is intentionally left blank.
- Payment schedule logic mirrors the current PAF Calculator implementation: deposit is capped at the lesser of 10% or $1,000; 33% is due through the progress stage; the remainder is due at installation; out-of-pocket funds are applied first at each stage.
- `pdf-lib` is loaded from unpkg on first use and then can be cached by the service worker. For fully self-contained offline deployment, vendor `pdf-lib.min.js` into the repository later.

## Finance programs

- S100617 - 6 Months - No Payments / No Interest
- S101217 - 12 Months - No Payments / No Interest
- R412006 - 6.99% - 10 Years
- R412009 - 9.99% - 10 Years
- R418006 - 6.99% - 15 Years
- R418009 - 9.99% - 15 Years
