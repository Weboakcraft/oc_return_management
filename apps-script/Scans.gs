/**
 * Scans.gs — the spreadsheet side of barcode scanning.
 *
 * The phone is the first home of a scan: the app saves every tracking ID to
 * the device the moment the camera reads it, so scanning keeps working in a
 * warehouse with no signal. This file is where those scans land afterwards,
 * when someone presses Upload.
 *
 * Two things matter here and both are handled under a script lock, because two
 * phones uploading at the same second must not be able to write the same
 * tracking ID twice:
 *
 *   - A tracking ID is unique across the whole sheet. An upload that contains
 *     one that is already stored is not an error; it is reported back as a
 *     duplicate so the phone can tick it off and stop resending it.
 *   - Comparison ignores case and surrounding spaces, the same rule the phone
 *     uses, so "trk 1001 " and "TRK 1001" are one parcel, not two.
 *
 * INSTALL
 *   1. Apps Script editor → new file called `Scans` → paste this in.
 *   2. Register the two routes in ROUTES in Code.gs (see the block at the
 *      bottom of this file for the exact lines).
 *   3. Deploy → Manage deployments → edit → New version → Deploy.
 *
 * The sheet itself is created the first time an upload arrives, so there is
 * nothing to run by hand.
 */

var SCANS_SHEET = 'Scans';
var SCANS_HEADERS = ['Scan_ID', 'Tracking_ID', 'Scanned_At', 'Scanned_By', 'Uploaded_At'];

/* ------------------------------------------------------------------ sheet */

/** The spreadsheet. The project's own getSS_() is used when it is there. */
function scansBook_() {
  if (typeof getSS_ === 'function') return getSS_();
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (book) return book;
  if (typeof CONFIG !== 'undefined' && CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  throw new Error('No spreadsheet bound. Set CONFIG.SPREADSHEET_ID in Config.gs.');
}

/** The Scans sheet, created with its header row the first time it is needed. */
function scansSheet_() {
  var book = scansBook_();
  var sheet = book.getSheetByName(SCANS_SHEET);
  if (!sheet) {
    sheet = book.insertSheet(SCANS_SHEET);
    sheet.getRange(1, 1, 1, SCANS_HEADERS.length).setValues([SCANS_HEADERS]);
    sheet.getRange(1, 1, 1, SCANS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 220);
  }
  return sheet;
}

/** The comparison key: the phone and the sheet must agree on what "same" means. */
function scanKey_(id) {
  return String(id == null ? '' : id).trim().toUpperCase();
}

/** Every tracking ID already stored, as a lookup. */
function scansIndex_(sheet) {
  var last = sheet.getLastRow();
  var index = {};
  if (last < 2) return index;
  sheet.getRange(2, 2, last - 1, 1).getValues().forEach(function (row) {
    var key = scanKey_(row[0]);
    if (key) index[key] = true;
  });
  return index;
}

/* ------------------------------------------------------------------ routes */

/**
 * saveScans — stores a batch of scans.
 *
 * payload: { scans: [ { trackingId, scannedAt, scannedBy } ] }
 * returns: { stored: [id…], duplicates: [id…], total, storedCount, duplicateCount }
 *
 * `duplicates` is the important half of the answer. Those rows are already in
 * the sheet, so the phone marks them done rather than queueing them forever.
 */
function saveScans(payload, session) {
  var incoming = (payload && payload.scans) || [];
  if (!(incoming instanceof Array) || !incoming.length) {
    return scansReply_({ stored: [], duplicates: [], total: 0, storedCount: 0, duplicateCount: 0 },
      'Nothing to store.');
  }
  if (incoming.length > 500) {
    return scansFail_('Send at most 500 scans in one upload.', 'VALIDATION_ERROR');
  }

  var who = (session && (session.username || session.user || session.name)) || '';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var sheet = scansSheet_();
    var stored = [];
    var duplicates = [];
    var rows = [];
    var seen = scansIndex_(sheet);
    var now = new Date();
    var next = sheet.getLastRow();   // header included, so this is also the count

    incoming.forEach(function (scan) {
      var id = String((scan && scan.trackingId) || '').trim();
      if (!id) return;

      var key = scanKey_(id);
      if (seen[key]) { duplicates.push(id); return; }
      seen[key] = true;               // guards against repeats inside one upload

      next++;
      rows.push([
        'SCN-' + Utilities.formatString('%06d', next - 1),
        id,
        (scan && scan.scannedAt) || now.toISOString(),
        (scan && scan.scannedBy) || who,
        now
      ]);
      stored.push(id);
    });

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCANS_HEADERS.length).setValues(rows);
    }

    return scansReply_({
      stored: stored,
      duplicates: duplicates,
      total: incoming.length,
      storedCount: stored.length,
      duplicateCount: duplicates.length
    }, 'Stored ' + stored.length + ' scans, ' + duplicates.length + ' were already there.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * getScans — reads scans back, newest first.
 * payload: { limit, q }
 */
function getScans(payload, session) {
  var limit = Math.min(Number((payload && payload.limit) || 500), 5000);
  var q = scanKey_((payload && payload.q) || '');

  var sheet = scansSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return scansReply_({ scans: [], total: 0 });

  var values = sheet.getRange(2, 1, last - 1, SCANS_HEADERS.length).getValues();
  var scans = [];

  for (var i = values.length - 1; i >= 0 && scans.length < limit; i--) {
    var row = values[i];
    if (q && scanKey_(row[1]).indexOf(q) === -1) continue;
    scans.push({
      scanId: row[0],
      trackingId: row[1],
      scannedAt: row[2] instanceof Date ? row[2].toISOString() : String(row[2] || ''),
      scannedBy: row[3],
      uploadedAt: row[4] instanceof Date ? row[4].toISOString() : String(row[4] || '')
    });
  }

  return scansReply_({ scans: scans, total: values.length });
}

/* ----------------------------------------------------------- reply helpers */

/*
 * The project's own ok()/bad() are used when they are there. The guard is not
 * paranoia: it means this file can be pasted in and tested before anything
 * else is touched, and it will still answer sensibly.
 */
function scansReply_(data, message) {
  if (typeof ok === 'function') return ok(data, message);
  return { success: true, data: data, message: message || '' };
}

/* bad() throws on its own in this project, so it is called, not thrown. */
function scansFail_(message, code) {
  if (typeof bad === 'function') bad(message, code || 'VALIDATION_ERROR');
  var e = new Error(message);
  e.errorCode = code || 'VALIDATION_ERROR';
  throw e;
}

/* ---------------------------------------------------------------- ROUTES

These two live in ROUTES in Code.gs:

    // barcode scanning
    saveScans: { fn: saveScans, roles: ALL_ROLES },
    getScans: { fn: getScans, roles: ALL_ROLES },

A route that is not in ROUTES is not reachable, and the app will say the
spreadsheet side is not installed yet.

-------------------------------------------------------------------------- */
