
const DRIVE_FOLDER_ID_PROP = 'DRIVE_FOLDER_ID'; // set via Script Properties
const PRODUCTION_EMAIL_PROP = 'PRODUCTION_EMAIL'; // set via Script Properties
const SERVICE_KEY_PROP = 'GDRIVE_SERVICE_KEY'; // set via Script Properties

// Column layout: adjust if your sheet differs
const ORDERS_SHEET = 'Orders';
const MOCKUPS_COL = 15; // column O (1-based)
const FOLDER_LINK_COL = 16; // column P (write-back for idempotency)
const ORDER_ID_COL = 1; // column A

const ORDER_LINES_SHEET = 'OrderLines';
const OL_ORDER_ID_COL = 1; // column A
const OL_FILEID_COL = 3;   // column C (fileId)

function processNewOrders() {
  const ss = SpreadsheetApp.getActive();
  const orders = ss.getSheetByName(ORDERS_SHEET);
  const lines = ss.getSheetByName(ORDER_LINES_SHEET);
  if (!orders || !lines) return;

  const orderRows = orders.getDataRange().getValues();
  const lineRows = lines.getDataRange().getValues();

// Map orderId -> raw art fileIds (gs://)
const rawByOrder = {};
lineRows.slice(1).forEach(r => {
  const oid = (r[OL_ORDER_ID_COL - 1] || '').trim();
  const fid = (r[OL_FILEID_COL - 1] || '').trim();
  if (oid && fid && fid.startsWith('gs://')) {
    if (!rawByOrder[oid]) rawByOrder[oid] = [];
    rawByOrder[oid].push(fid);
  }
});


  for (let i = 1; i < orderRows.length; i++) { // skip header
    const row = orderRows[i];
    const orderId = (row[ORDER_ID_COL - 1] || '').trim();
    if (!orderId) continue;

    // skip if already processed (folder link present)
    const folderLinkCell = row[FOLDER_LINK_COL - 1];
    if (folderLinkCell) continue;

    // Columns (1-based): mockups O=15, folderLink P=16, shipping Q–W=17–23, orderNote X=24, sizeBreakdown Y=25
    const mockupsJson = (row[MOCKUPS_COL - 1] || '').trim();
    let mockups = {};
    try { mockups = JSON.parse(mockupsJson); } catch (_) {}

    const filesToCopy = [];
    ['front', 'back'].forEach(side => {
      const p = mockups[side];
      if (p && p.startsWith('gs://')) filesToCopy.push({ path: p, name: `${side}.png` });
    });
    (rawByOrder[orderId] || []).forEach((p, idx) => {
      filesToCopy.push({ path: p, name: `art-${idx + 1}${guessExt(p)}` });
    });

    const folderId = createOrderFolder(orderId);
    filesToCopy.forEach(f => copyGcsToDrive(f.path, folderId, f.name));
    const folderLink = `https://drive.google.com/drive/folders/${folderId}`;
    orders.getRange(i + 1, FOLDER_LINK_COL).setValue(folderLink);

    // Build email fields from row
    const custEmail   = row[3];   // D email
    const custName    = row[4];   // E name
    const custPhone   = row[5];   // F phone
    const subtotalAmt = row[6];   // G
    const shippingAmt = row[8];   // I
    const totalAmt    = row[9];   // J
    const shipName    = row[16];  // Q
    const shipLine1   = row[17];  // R
    const shipLine2   = row[18];  // S
    const shipCity    = row[19];  // T
    const shipState   = row[20];  // U
    const shipPostal  = row[21];  // V
    const shipCountry = row[22];  // W
    const orderNote   = row[23];  // X
    const sizeBreak   = row[24];  // Y

    // Build Items summary from OrderLines
const linesForOrder = lineRows.slice(1).filter(r => (r[OL_ORDER_ID_COL - 1] || '').trim() === orderId);
const placementBySku = {}; // { sku: Set(['FRONT','BACK',...]) }
linesForOrder.forEach(r => {
  const sku = (r[3] || '').toString().trim() || 'SKU';
  const placement = (r[4] || 'front').toUpperCase();
  if (!placementBySku[sku]) placementBySku[sku] = new Set();
  placementBySku[sku].add(placement);
});
const itemSummary = Object.entries(placementBySku)
  .map(([sku, set]) => `${sku}: ${[...set].sort().join(' & ')}`)
  .join('<br>');

MailApp.sendEmail({
  to: getProductionEmail(),
  subject: `Order ${orderId} assets`,
  htmlBody: `
    <div style="font-family: Arial, sans-serif; line-height:1.5;">
      <h3>Order ${orderId}</h3>
      <p><strong>Customer:</strong> ${custName || '—'} (${custEmail || '—'})<br>
         <strong>Phone:</strong> ${custPhone || '—'}</p>
      <p><strong>Shipping address:</strong><br>
         ${shipName || ''}<br>
         ${shipLine1 || ''} ${shipLine2 || ''}<br>
         ${shipCity || ''}, ${shipState || ''} ${shipPostal || ''}<br>
         ${shipCountry || ''}</p>
      <p><strong>Summary:</strong><br>
         Subtotal: $${subtotalAmt || 0}<br>
         Shipping: $${shippingAmt || 0}<br>
         Total: $${totalAmt || 0}</p>
      <p><strong>Size breakdown:</strong> ${sizeBreak || '—'}</p>
      <p><strong>Items:</strong><br>${itemSummary || '—'}</p>
      <p><strong>Order note:</strong> ${orderNote || '—'}</p>
      <p><strong>Link to the Assets:</strong><br>
         <a href="${folderLink}">${folderLink}</a></p>
    </div>
  `
});

  }
}

// Helpers below stay the same
function createOrderFolder(orderId) {
  const root = DriveApp.getFolderById(getDriveFolderId());
  return root.createFolder(`order-${orderId}`).getId();
}

function copyGcsToDrive(gsPath, folderId, outName) {
  const key = getServiceKey();
  const { bucket, object } = parseGsPath(gsPath);
  const url = buildSignedUrl(bucket, object, key);
  const blob = UrlFetchApp.fetch(url).getBlob().setName(outName || object.split('/').pop());
  DriveApp.getFolderById(folderId).createFile(blob);
}

function parseGsPath(gs) {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(gs);
  if (!m) throw new Error('Bad gs:// path: ' + gs);
  return { bucket: m[1], object: m[2] };
}

function guessExt(path) {
  const m = path.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif|svg)$/);
  return m ? `.${m[1]}` : '';
}

// V4 signed URL for GET
function buildSignedUrl(bucket, object, key) {
  const host = 'storage.googleapis.com';
  const now = new Date();
  const datestamp = Utilities.formatDate(now, 'UTC', 'yyyyMMdd');
  const amzDate = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const scope = `${datestamp}/auto/storage/goog4_request`;
  const encodedObject = encodeURIComponent(object).replace(/%2F/g, '/');
  const canonicalQuery = [
    `X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    `X-Goog-Credential=${encodeURIComponent(key.client_email + '/' + scope)}`,
    `X-Goog-Date=${amzDate}`,
    `X-Goog-Expires=300`,
    `X-Goog-SignedHeaders=host`
  ].join('&');
  const canonicalRequest = ['GET', `/${bucket}/${encodedObject}`, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonicalRequest)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  const stringToSign = ['GOOG4-RSA-SHA256', amzDate, scope, hash].join('\n');
  const signature = Utilities.computeRsaSha256Signature(stringToSign, key.private_key)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  return `https://${host}/${bucket}/${encodedObject}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

function getServiceKey() {
  const raw = getRequiredScriptProperty(SERVICE_KEY_PROP);
  return JSON.parse(raw);
}

function getRequiredScriptProperty(propName) {
  const value = PropertiesService.getScriptProperties().getProperty(propName);
  if (!value) throw new Error('Missing script property: ' + propName);
  return value;
}

function getDriveFolderId() {
  return getRequiredScriptProperty(DRIVE_FOLDER_ID_PROP);
}

function getProductionEmail() {
  return getRequiredScriptProperty(PRODUCTION_EMAIL_PROP);
}
