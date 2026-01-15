# Apps Script for Orders Sheet

This folder holds the Apps Script code used by the Google Sheet to copy assets from GCS to Drive and email production.

## How to use (manual paste)
1) Open the Orders Google Sheet → Extensions → Apps Script.
2) Replace the script contents with `Create_Production_Order.gs` from this folder.
3) In Apps Script → Project Settings → Script Properties, set:
   - `GDRIVE_SERVICE_KEY` = your service account JSON (one line).
   - `DRIVE_FOLDER_ID` = your Drive folder ID for order subfolders.
   - `PRODUCTION_EMAIL` = recipient for production notifications.
4) Set a trigger: Triggers → add time-driven trigger for `processNewOrders` (e.g., every minute).
5) Ensure the Orders tab has columns: A orderId … N currency | O mockups | P folderLink | Q–W shipping | X order note | Y size breakdown. OrderLines has fileId in col C.

## How to use with clasp (optional)
1) Install: `npm install -g @google/clasp`
2) `clasp login` (browser auth)
3) `clasp clone <your_script_id>` or `clasp create --type sheets --title "QuickTees Sheet Script"`
4) Edit locally, then `clasp push` to deploy. Use `.clasp.json` for script ID; do **not** commit secrets.
