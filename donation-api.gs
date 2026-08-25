/**
 * Apps Script web app backing the Mandal site's donation lookups.
 *
 * SETUP (once):
 *   1. Project Settings > Script properties > Add:
 *        ACCESS_CODE = <the Karyakarta code>
 *      Use something long — 10+ characters, not 1010. The code is never
 *      published in the website source, so it can be as long as you like.
 *   2. Deploy > New deployment > Web app, Execute as "Me", Access "Anyone".
 *   3. Put the /exec URL in assets/site.js (window.WEBAPP_URL).
 *   After ANY code edit: Deploy > Manage deployments > edit > New version.
 *
 * ENDPOINTS
 *   ?code=..&validate=1                  -> {ok:true} if the code is right
 *   ?code=..&receipt=|name=|mobile=       -> full records (Karyakarta only)
 *   ?receipt=<exact>                      -> ONE public receipt, private
 *                                            fields stripped (used by
 *                                            contact.html, no code needed)
 *   ?code=..&headers=1                    -> column mapping, for debugging
 */

const SHEET_ID = '1vmOimXy1PkslPHQLwROBce0nGSs0yUr3mKIEjRYpOeo';
const SHEET_GID = 1341717664;

// Fields a donor may see about their own receipt. Everything else — mobile
// number, edit link, internal remarks — is Karyakarta-only.
const PUBLIC_FIELDS = ['ReceiptNumber', 'Date', 'Name', 'Amount', 'Receiver', 'Status'];

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

/**
 * Is this request from a Karyakarta who supplied the right code?
 *
 * Wrong codes are counted in a short-lived cache and the endpoint stops
 * answering once there are too many. ponytail: the counter is global, not
 * per-IP (Apps Script does not expose the caller's IP), so a determined
 * attacker could lock Karyakartas out for 10 minutes. That is the cheap
 * trade; a long ACCESS_CODE is what actually makes guessing hopeless.
 */
function authorized_(code) {
  const expected = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!expected) throw new Error('Server not configured: set the ACCESS_CODE script property.');
  if (!code) return false;

  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= 30) throw new Error('Too many incorrect attempts. Please try again in a few minutes.');

  if (String(code) === String(expected)) return true;

  cache.put('fails', String(fails + 1), 600);  // 10 minute window
  return false;
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
    const isKaryakarta = authorized_(p.code);

    if (p.validate) {
      if (!isKaryakarta) return json_({ error: 'unauthorized' });
      return json_({ ok: true });
    }

    const receipt = (p.receipt || '').trim().toLowerCase();
    const name    = (p.name    || '').trim().toLowerCase();
    const mobile  = (p.mobile  || '').replace(/\D/g, '');

    // Without the code, the ONLY thing on offer is one exact receipt.
    // Searching by name or mobile — i.e. browsing the donor list — is not public.
    if (!isKaryakarta) {
      if (p.headers) return json_({ error: 'unauthorized' });
      if (!receipt) return json_({ error: 'unauthorized' });
      if (name || mobile) return json_({ error: 'unauthorized' });
    }

    const sheet = sheet_();
    const rows = sheet.getDataRange().getDisplayValues();
    if (rows.length < 2) return json_({ error: 'Sheet is empty.' });

    const headers = rows[0];
    const col = columnMap_(headers);
    const tsCol = headers.map(function (h) { return String(h).trim().toLowerCase(); }).indexOf('timestamp');

    if (p.headers) {
      const unmapped = Object.keys(FIELDS).filter(function (f) { return col[f] === undefined; });
      return json_({ sheet: sheet.getName(), headers: headers, mapped: col, unmapped: unmapped });
    }

    if (!receipt && !name && !mobile) return json_({ error: 'Please enter at least one search criteria.' });

    const get = function (row, field) {
      const i = col[field];
      return i === undefined ? '' : String(row[i] || '').trim();
    };

    const raw = sheet.getDataRange().getValues();  // for real Date objects on Timestamp
    let links = null;                              // built lazily, only if there are matches
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.join('').trim() === '') continue;

      if (receipt && get(row, 'ReceiptNumber').toLowerCase() !== receipt) continue;
      if (name && get(row, 'Name').toLowerCase().indexOf(name) === -1) continue;
      if (mobile && get(row, 'Mobile').replace(/\D/g, '').indexOf(mobile) === -1) continue;

      const entry = {};
      const wanted = isKaryakarta ? Object.keys(FIELDS) : PUBLIC_FIELDS;
      wanted.forEach(function (f) { entry[f] = get(row, f); });

      if (isKaryakarta) {
        entry.Row = r + 1;
        entry.EditLink = '';
        if (tsCol !== -1) {
          if (!links) links = editLinks_(sheet);
          const ts = new Date(raw[r][tsCol]);
          if (!isNaN(ts.getTime())) entry.EditLink = links[ts.getTime()] || '';
        }
      }
      out.push(entry);

      // A donor looking up their own receipt gets exactly that one row.
      if (!isKaryakarta) break;
    }

    if (!out.length) return json_({ error: 'No matching record found.' });
    return json_(out);
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

/** Run in the editor to check the column mapping against the live sheet. */
function testMapping() {
  const rows = sheet_().getDataRange().getDisplayValues();
  const col = columnMap_(rows[0]);
  const unmapped = Object.keys(FIELDS).filter(function (f) { return col[f] === undefined; });
  Logger.log('Headers found: %s', rows[0].join(' | '));
  Logger.log('Mapped: %s', JSON.stringify(col));
  Logger.log('UNMAPPED (will come back blank on the site): %s', unmapped.join(', ') || 'none');
  Logger.log('Data rows: %s', rows.length - 1);
  Logger.log('ACCESS_CODE set: %s',
    PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') ? 'yes' : 'NO — set it before deploying');
  if (!col.Name && !col.ReceiptNumber) throw new Error('Neither Name nor ReceiptNumber mapped — search will not work.');
}
