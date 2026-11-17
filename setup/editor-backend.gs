/**
 * T/aco website editor: the part that lives on the Google Sheet.
 *
 * The website reads the sheet through this script, and editor.html saves to the sheet through it.
 * Reading what is on the website (Live and Sold out items, hours, address) is open to anyone.
 * Drafts and Hidden items, and saving, need the passcode below.
 *
 * Set-up, once, by the owner of the sheet:
 *   1. Open the sheet. Extensions > Apps Script. Delete what is there and paste this whole file.
 *   2. Change PASSCODE below to something long that only T/aco knows (sixteen characters or more).
 *   3. In the function menu at the top choose setUp and press Run. It adds the four tabs the website reads, if they are missing.
 *   4. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy, and approve the prompt.
 *   5. Copy the web app address (it ends in /exec) into src/data/site.json, in  "sheet": { "api": "..." }.
 * After changing this file later: Deploy > Manage deployments > edit > Version: New version.
 *
 * @OnlyCurrentDoc   (this script may touch this spreadsheet and no other)
 */
var PASSCODE = 'change-me-before-deploying';
var TABS = { Menu: 7, Sections: 6, Hours: 4, Info: 3 };   // tab name: number of columns the website reads
var HEADERS = {
  Menu: ['Status', 'Section', 'Item', 'Description', 'Price', 'Starts at', 'Note'],
  Sections: ['Section', 'Heading on the site', 'Price for every item', 'In the quick links', 'Layout', 'Note under the section'],
  Hours: ['Day', 'Opens', 'Closes', 'Closed all day'],
  Info: ['Setting', 'Value', 'Where it shows']
};
var STATUSES = ['live', 'draft', 'hidden', 'sold out'];
var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var MAX_ROWS = 600, MAX_CELL = 2000;

/** Run once from the Apps Script editor: adds any of the four tabs that are missing, with their header row. */
function setUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, TABS[name]).setValues([HEADERS[name]]);
  });
}

/** What the website reads: no passcode, and so nothing that is not public. */
function doGet() {
  var lock = LockService.getScriptLock(), held = lock.tryLock(5000);   // do not read half of someone's save
  try {
    var tabs = readTabs_();
    return json_({ ok: true, rev: rev_(tabs), tabs: publicTabs_(tabs) });
  } finally { if (held) lock.releaseLock(); }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (!body || typeof body !== 'object') return json_({ ok: false, error: 'bad request' });

  // The right passcode always works. Wrong ones are counted, and after eight in ten minutes each further wrong try is slowed down.
  // Nobody can lock the owner out by guessing; a long passcode is what keeps guessing hopeless.
  if (PASSCODE === 'change-me-before-deploying' || !same_(body.passcode, PASSCODE)) {
    var cache = CacheService.getScriptCache(), misses = Number(cache.get('misses') || 0) + 1;
    cache.put('misses', String(misses), 600);
    if (misses > 8) Utilities.sleep(3000);
    return json_({ ok: false, error: 'passcode', message: 'That passcode is not right.' });
  }

  if (body.action === 'check') return json_({ ok: true, rev: rev_(readTabs_()) });
  if (body.action === 'read') {                                   // the editor: everything, Drafts and Hidden included
    var all = readTabs_();
    return json_({ ok: true, rev: rev_(all), tabs: all });
  }
  if (body.action !== 'write' || !body.tabs) return json_({ ok: false, error: 'bad request' });
  // An editor page from before Drafts were kept private only ever saw the public rows; saving from it would erase the rest.
  if (!body.full) return json_({ ok: false, error: 'old editor', message: 'This editor page is out of date. Reload it, then make your change again.' });

  var problem = problem_(body.tabs);                              // check all of it before touching anything
  if (problem) return json_({ ok: false, error: 'invalid', message: problem });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy', message: 'Someone else is saving. Try again in a moment.' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), sheets = {}, missing = [];
    Object.keys(TABS).forEach(function (name) { sheets[name] = ss.getSheetByName(name); if (!sheets[name]) missing.push(name); });
    if (missing.length) return json_({ ok: false, error: 'missing tab', message: 'The sheet has no tab called ' + missing.join(' or ') + '. Nothing was changed.' });

    // the sheet changed since this editor loaded it, through the editor or by hand: do not overwrite that work
    var before = readTabs_();
    if (String(body.rev) !== rev_(before)) return json_({ ok: false, error: 'stale', message: 'The sheet changed since you opened the editor. Reload to see the latest, then make your change again.' });

    try {
      Object.keys(TABS).forEach(function (name) { put_(sheets[name], TABS[name], body.tabs[name].slice(1)); });
      SpreadsheetApp.flush();
    } catch (err) {
      try {                                                       // put back exactly what was there
        Object.keys(TABS).forEach(function (name) { put_(sheets[name], TABS[name], before[name].slice(1)); });
        SpreadsheetApp.flush();
      } catch (err2) {
        return json_({ ok: false, error: 'partial', message: 'Saving stopped part-way and could not be undone. Open the sheet, File > Version history, and restore the version from before this save.' });
      }
      return json_({ ok: false, error: 'failed', message: 'That did not save. Nothing on the website changed.' });
    }
    return json_({ ok: true, rev: rev_(readTabs_()) });           // read back what is actually there now
  } finally { lock.releaseLock(); }
}

/** Rows for one tab, below the header. Keeps the header row, the dropdowns and the formatting. */
function put_(sh, cols, rows) {
  var data = rows.map(function (r) { var out = []; for (var i = 0; i < cols; i++) out.push(cell_(r[i])); return out; });
  var last = Math.max(sh.getLastRow(), 2);
  sh.getRange(2, 1, last - 1, cols).clearContent();
  if (data.length) sh.getRange(2, 1, data.length, cols).setValues(data);
}
/** Text that begins like a formula is stored as text. */
function cell_(v) {
  if (v == null) return '';
  if (typeof v === 'string' && /^[=+@]/.test(v)) return "'" + v;
  return v;
}

/** The first thing wrong with what was sent, in words the owner can act on; '' if nothing is. */
function problem_(tabs) {
  var names = Object.keys(TABS);
  for (var n = 0; n < names.length; n++) {
    var name = names[n], rows = tabs[name];
    if (!Array.isArray(rows) || !rows.length) return 'The ' + name + ' part of the save was missing. Nothing was changed.';
    if (rows.length > MAX_ROWS) return 'Too many rows in ' + name + '. Nothing was changed.';
    for (var i = 0; i < rows.length; i++) {
      if (!Array.isArray(rows[i])) return 'Row ' + (i + 1) + ' of ' + name + ' was not readable. Nothing was changed.';
      for (var c = 0; c < rows[i].length; c++) {
        var v = rows[i][c], t = typeof v;
        if (v != null && t !== 'string' && t !== 'number') return 'Row ' + (i + 1) + ' of ' + name + ' was not readable. Nothing was changed.';
        if (t === 'string' && v.length > MAX_CELL) return 'Something in ' + name + ' is too long. Nothing was changed.';
      }
    }
  }
  var m;
  for (m = 1; m < tabs.Menu.length; m++) {
    var r = tabs.Menu[m], item = String(r[2] == null ? '' : r[2]).trim();
    if (!item) return 'A menu item has no name. Nothing was changed.';
    if (STATUSES.indexOf(String(r[0] || '').toLowerCase()) < 0) return '“' + item + '” has a status the website does not know. Nothing was changed.';
    if (!price_(r[4])) return 'The price of “' + item + '” is not a number like 5.95. Nothing was changed.';
  }
  for (m = 1; m < tabs.Sections.length; m++) {
    if (!String(tabs.Sections[m][0] == null ? '' : tabs.Sections[m][0]).trim()) return 'A menu section has no name. Nothing was changed.';
    if (!price_(tabs.Sections[m][2])) return 'The price for “' + tabs.Sections[m][0] + '” is not a number like 5.95. Nothing was changed.';
  }
  var seen = {};
  for (m = 1; m < tabs.Hours.length; m++) {
    var h = tabs.Hours[m], day = String(h[0] || '').toLowerCase();
    if (DAYS.indexOf(day) < 0 || seen[day]) return 'The hours need each day of the week once. Nothing was changed.';
    seen[day] = 1;
    var closed = /^y/i.test(String(h[3] || ''));
    if (!closed && (!time_(h[1]) || !time_(h[2]))) return h[0] + ' needs an opening and a closing time, or Closed all day. Nothing was changed.';
  }
  if (Object.keys(seen).length !== 7) return 'The hours need all seven days. Nothing was changed.';
  for (m = 1; m < tabs.Info.length; m++) {
    var key = String(tabs.Info[m][0] || ''), val = String(tabs.Info[m][1] == null ? '' : tabs.Info[m][1]).trim();
    if (!key.trim()) return 'A detail has no name. Nothing was changed.';
    if (/ link$/i.test(key) && val && !/^https?:\/\/\S+$/i.test(val)) return '“' + key + '” needs a web address that starts with https://. Nothing was changed.';
  }
  return '';
}
function price_(v) { return v === '' || v == null || (typeof v === 'number' ? isFinite(v) && v >= 0 : /^\$?\s*\d+(\.\d{1,2})?$/.test(String(v).trim())); }
function time_(v) { return /^\s*\d{1,2}(:\d{2})?(:\d{2})?\s*([ap]\.?m\.?)?\s*$/i.test(String(v == null ? '' : v)); }

function readTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = {};
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh) { out[name] = []; return; }
    var rows = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), TABS[name]).getDisplayValues();
    out[name] = rows.filter(function (r, i) { return i === 0 || r.join('') !== ''; });
  });
  return out;
}
/** The same tabs without the rows that are not on the website. */
function publicTabs_(tabs) {
  var out = {};
  Object.keys(tabs).forEach(function (name) { out[name] = tabs[name]; });
  out.Menu = tabs.Menu.filter(function (r, i) { var s = String(r[0] || 'live').toLowerCase(); return i === 0 || s === 'live' || s === 'sold out'; });
  return out;
}
/** A fingerprint of what the sheet holds. It changes whenever the content does, whoever changed it and however. */
function rev_(tabs) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(tabs), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b + 256) % 256 + 256).toString(16).slice(1); }).join('');
}
function same_(a, b) {                                            // compares every character, however early they differ
  a = String(a == null ? '' : a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
