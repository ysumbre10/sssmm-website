// Apps Script web app backing internal.html / internal-marathi.html
// Deploy: Deploy > New deployment > Web app > Execute as "Me", Access "Anyone"
// Then paste the new /exec URL into both internal*.html files.

const SHEET_ID = '1vmOimXy1PkslPHQLwROBce0nGSs0yUr3mKIEjRYpOeo';
const SHEET_GID = 1341717664;

// Output field -> substrings to look for in the header row (headers carry trailing " :").
const FIELDS = {
  ReceiptNumber: ['पावती क्रमांक', 'receipt'],
  Date:          ['तारीख'],                    // "तारीख :" — receipt date, NOT the form Timestamp
  Name:          ['नाव'],                      // must stay above Receiver: "स्वीकर्त्याचे नाव" also contains नाव
  Mobile:        ['मोबाईल'],
  Amount:        ['रक्कम'],
  Receiver:      ['स्वीकर्त्या', 'स्वीकारकर्ता'],
  Status:        ['भरणा स्थिती', 'स्थिती'],
  DonationDate:  ['देणगी देण्याची तारीख'],
  Remark:        ['नोंद'],
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const s = ss.getSheets().filter(function (x) { return x.getSheetId() === SHEET_GID; })[0];
  if (!s) throw new Error('Tab with gid ' + SHEET_GID + ' not found in the spreadsheet.');
  return s;
}

// header row -> { FieldName: columnIndex }
function columnMap_(headers) {
  const norm = headers.map(function (h) { return String(h).trim().toLowerCase(); });
  const map = {};
  Object.keys(FIELDS).forEach(function (field) {
    const aliases = FIELDS[field];
    for (let i = 0; i < norm.length; i++) {
      if (aliases.indexOf(norm[i]) !== -1) { map[field] = i; return; }
    }
    // fall back to a partial match so "Receipt Number (2025)" still lands
    for (let i = 0; i < norm.length; i++) {
      for (let a = 0; a < aliases.length; a++) {
        if (norm[i] && norm[i].indexOf(aliases[a]) !== -1) { map[field] = i; return; }
      }
    }
  });
  return map;
}

// Timestamp(ms) -> form edit URL, so Karyakartas can edit an entry.
// Empty if the sheet has no linked form; the site degrades to "no edit link".
function editLinks_(sheet) {
  const map = {};
  try {
    const url = sheet.getFormUrl();
    if (!url) return map;
    FormApp.openByUrl(url).getResponses().forEach(function (r) {
      map[r.getTimestamp().getTime()] = r.getEditResponseUrl();
    });
  } catch (err) {
    Logger.log('edit links unavailable: %s', err);
  }
  return map;
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const sheet = sheet_();
    const rows = sheet.getDataRange().getDisplayValues();
    if (rows.length < 2) return json_({ error: 'Sheet is empty.' });

    const headers = rows[0];
    const col = columnMap_(headers);
    const tsCol = headers.map(function (h) { return String(h).trim().toLowerCase(); }).indexOf('timestamp');

    // ?headers=1 -> show what mapped, for setup/debugging
    if (p.headers) {
      const unmapped = Object.keys(FIELDS).filter(function (f) { return col[f] === undefined; });
      return json_({ sheet: sheet.getName(), headers: headers, mapped: col, unmapped: unmapped });
    }

    const receipt = (p.receipt || '').trim().toLowerCase();
    const name    = (p.name    || '').trim().toLowerCase();
    const mobile  = (p.mobile  || '').replace(/\D/g, '');
    if (!receipt && !name && !mobile) return json_({ error: 'Please enter at least one search criteria.' });

    const get = function (row, field) {
      const i = col[field];
      return i === undefined ? '' : String(row[i] || '').trim();
    };

    const raw = sheet.getDataRange().getValues();  // for real Date objects on Timestamp
    let links = null;                               // built lazily, only if there are matches
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.join('').trim() === '') continue;

      if (receipt && get(row, 'ReceiptNumber').toLowerCase() !== receipt) continue;
      if (name && get(row, 'Name').toLowerCase().indexOf(name) === -1) continue;
      if (mobile && get(row, 'Mobile').replace(/\D/g, '').indexOf(mobile) === -1) continue;

      const entry = {};
      Object.keys(FIELDS).forEach(function (f) { entry[f] = get(row, f); });
      entry.Row = r + 1;
      entry.EditLink = '';
      if (tsCol !== -1) {
        if (!links) links = editLinks_(sheet);
        const ts = new Date(raw[r][tsCol]);
        if (!isNaN(ts.getTime())) entry.EditLink = links[ts.getTime()] || '';
      }
      out.push(entry);
    }

    if (!out.length) return json_({ error: 'No matching record found.' });
    return json_(out);
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

// Run this in the Apps Script editor to check the mapping before deploying.
function testMapping() {
  const rows = sheet_().getDataRange().getDisplayValues();
  const col = columnMap_(rows[0]);
  const unmapped = Object.keys(FIELDS).filter(function (f) { return col[f] === undefined; });
  Logger.log('Headers found: %s', rows[0].join(' | '));
  Logger.log('Mapped: %s', JSON.stringify(col));
  Logger.log('UNMAPPED (will come back blank on the site): %s', unmapped.join(', ') || 'none');
  Logger.log('Data rows: %s', rows.length - 1);
  if (!col.Name && !col.ReceiptNumber) throw new Error('Neither Name nor ReceiptNumber mapped — search will not work.');
}
