# Designer.Gorillaprintshop — Architecture Summary (Dec 6, 2025)

## Executive Summary
- Users pick a shirt, upload art, preview front/back, enter sizes, and pay with Stripe.
- Raw art and mockups are stored in a Google Cloud Storage bucket; mockups are generated at checkout.
- After payment, an Apps Script copies mockups + art into a Drive order folder and emails production one link with all details (customer, shipping, sizes, placements).
- Everything runs from the single-page app in `docs/`, with Netlify functions for upload/checkout, a Stripe webhook for the sheet, and an Apps Script for the production package.

---

## Repo Map
```
/docs
  index.html             # main UI
  js/
    app.js               # canvas, bg/crop, mockups, uploads, checkout
    order-panel.js       # checkout panel UI wiring
    bagel-select.js      # blank selector UI
    fitline.js           # text-fit helper
    order-panel-shell.js # panel open/close
  assets/shirt_blanks/
    manifest.json        # blanks → sku + preview file
    *.png/jpg            # front/back blank images
  config/tiers.js        # derive DTF tier from size
  style.css              # styles
  success.html           # post-checkout success page
/netlify/functions
  create-upload-url.js   # signed PUT to GCS (primary upload path)
  create-checkout.js     # Stripe Checkout (garment + DTF + shipping)
  stripe-webhook.js      # writes paid orders to Google Sheets (Orders + OrderLines)
  get-prices.js          # fetches Stripe price amounts for client
  shipping-config.js     # serves shipping.json
  upload-to-drive.js     # legacy multipart → Drive (not used for art now)
  config/prices.js       # Stripe price IDs (garments + DTF tiers)
  config/shipping.json   # UPS Ground count-based table
netlify.toml             # publish/docs + functions path
package.json             # deps: stripe, googleapis, busboy, etc.
```

## Environment Variables (Netlify)
| Name | Required | Notes |
| --- | :---: | --- |
| `GDRIVE_SERVICE_KEY` | ✅ | Service account JSON (one line) for Drive/Sheets |
| `DRIVE_FOLDER_ID` | ✅ | Shared folder for order subfolders (SA must have access) |
| `STRIPE_SECRET_KEY` | ✅ | Matches price IDs in `config/prices.js` |
| `STRIPE_WEBHOOK_SECRET` | ✅ | From Stripe dashboard webhook |
| `SITE_URL` | ✅ | Used for success/cancel URLs |
| `ORDERS_SPREADSHEET_ID` | ✅ | Google Sheet ID |
| `GCS_BUCKET` | ✅ | `gorilla-designer-uploads` |
| `GCS_UPLOAD_PREFIX` | ☐ | Optional (defaults to `uploads`) |
| (legacy) `PRICE_ID` | ☐ | Not used; per-SKU pricing instead |

Shared Drive reminder: add the **service account email** to the Drive folder (Content Manager+), and use `supportsAllDrives: true` (already in code).

## Data Flow (end-to-end)
1) Upload  
   - Browser calls `/.netlify/functions/create-upload-url` → gets signed PUT URL.  
   - Browser PUTs file to GCS; stores `gs://...` fileId in order state.
2) Mockups  
   - At checkout, front/back PNGs are captured sequentially; uploads to GCS.  
   - Raw art + mockup paths go into Stripe metadata.
3) Checkout (`create-checkout.js`)  
   - Builds line items: garment price (by SKU) + decoration price (DTF tier/placement) + shipping from `shipping.json`; Stripe Tax on; success/cancel from `SITE_URL`.
4) Webhook (`stripe-webhook.js`)  
   - On `checkout.session.completed`, writes Orders (mockups, shipping, note, size breakdown) and OrderLines (front/back rows with gs:// fileIds, pricing, sizes). Idempotent on `session.id`.
5) Sheet → Drive/email (Apps Script)  
   - Time-driven trigger: finds Orders rows without folderLink, copies mockups + raw art from GCS to a new Drive subfolder under `DRIVE_FOLDER_ID`, writes folderLink, emails production with customer/shipping, size breakdown, item summary (“SKU: FRONT & BACK”), and the folder link.

## Sheets Layout
- Orders: `A orderId | … | N currency | O mockups | P folderLink | Q–W shipping | X order note | Y size breakdown`.
- OrderLines: `orderId | designLabel | fileId | garmentSKU | placement | sizesJson | tier | readoutW_in | readoutH_in | garment_unit | garment_qty | garment_subtotal | decoration_sku | decoration_unit | decoration_qty | decoration_subtotal | line_total`.

## API Contracts (live)
- `POST /.netlify/functions/create-upload-url` → `{ fileName }` → `{ url, objectName, bucket, publicUrl }` (signed PUT).  
- `PUT <signed-url>` with raw bytes → 200 on success.  
- `POST /.netlify/functions/create-checkout` → `{ email, customerName, customerPhone, productId, sizeRun, sides/mockups, orderNote }` → `{ url }`.  
- `POST /.netlify/functions/stripe-webhook` → Stripe-signed; no direct client use.

## Troubleshooting (fast)
- Upload fails/CORS → bucket CORS must allow `https://designer.gorillaprintshop.com` for `PUT/OPTIONS`; confirm `GCS_BUCKET`.  
- Unknown garment SKU → manifest `sku` must match `GARMENT_PRICE_IDS` keys.  
- Art too large (>16") or qty ≥36 → intentional 400 (screenprint-only).  
- Stripe “invalid API key/price” → check `STRIPE_SECRET_KEY` vs price IDs account/mode.  
- Webhook no-op → verify `STRIPE_WEBHOOK_SECRET`, Sheet ID/tab names, Orders range A:Y, time-driven Apps Script trigger.  
- Drive copy missing art/mockups → ensure OrderLines col C has gs:// fileIds; confirm Apps Script trigger is running.

## Ops Quickies
```bash
# Reachability (405/403 OK for POST-only endpoints)
curl -I https://designer.gorillaprintshop.com/.netlify/functions/create-checkout
curl -I https://designer.gorillaprintshop.com/.netlify/functions/create-upload-url

# Smoke test signed upload (replace /tmp/test.png)
curl -s -X POST https://designer.gorillaprintshop.com/.netlify/functions/create-upload-url \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"test.png"}'
# Then PUT the file to returned url:
# curl -X PUT "<signed-url>" -H "Content-Type: image/png" --data-binary @/tmp/test.png
```

## Current Status / Fixes
- Mockup capture waits for the correct front/back blank to load (prevents swapped shirt images).  
- Webhook imports price maps, writes both sides, and adds size breakdown.  
- Apps Script email: “SKU: FRONT & BACK,” includes size breakdown, shipping, Drive folder link.  
- Time-driven trigger avoids duplicate emails/folders.

## Legacy / Cleanup
- `upload-to-drive.js` retained for now; primary upload path is GCS signed URLs.  
- “Pending/quote” flows and `create-order.js` remain retired; Checkout + paid webhook is live.  
- This doc supersedes older architecture guides; keep older files only for historical reference.

## Possible Future Tweaks
- Add client-side retry/backoff on uploads.  
- Remove `upload-to-drive.js` when confident in GCS-only flow.  
- If Apps Script ever times out on huge files, move GCS→Drive copy to a small GCP function.
