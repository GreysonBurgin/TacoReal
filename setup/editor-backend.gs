/**
 * T/aco website editor: the part that lives on the Google Sheet.
 *
 * The website reads the sheet through this script, and editor.html saves to the sheet through it.
 * Reading is open to anyone (it is the menu, hours and address). Saving needs the passcode below.
 *
 * Set-up, once, by the owner of the sheet:
 *   1. Open the sheet. Extensions > Apps Script. Delete what is there and paste this whole file.
 *   2. Change PASSCODE below to something long that only T/aco knows.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy, and approve the prompt.
 *   4. Copy the web app address (it ends in /exec) into src/data/site.json, in  "sheet": { "api": "..." }.
 * After changing this file later: Deploy > Manage deployments > edit > Version: New version.
 */
var PASSCODE = 'change-me-before-deploying';
var TABS = { Menu: 7, Sections: 6, Hours: 4, Info: 3 };   // tab name: number of columns the website reads

function doGet() {
  return json_({ ok: true, rev: rev_(), tabs: readTabs_() });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }

  var cache = CacheService.getScriptCache(), misses = Number(cache.get('misses') || 0);
  if (misses >= 8) return json_({ ok: false, error: 'locked', message: 'Too many wrong passcodes. Try again in ten minutes.' });
  if (PASSCODE === 'change-me-before-deploying' || body.passcode !== PASSCODE) {
    cache.put('misses', String(misses + 1), 600);
    return json_({ ok: false, error: 'passcode', message: 'That passcode is not right.' });
  }

  if (body.action === 'check') return json_({ ok: true, rev: rev_() });
  if (body.action !== 'write' || !body.tabs) return json_({ ok: false, error: 'bad request' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy', message: 'Someone else is saving. Try again in a moment.' });
  try {
    // someone else published since this editor loaded: do not overwrite their work
    if (String(body.rev) !== String(rev_())) return json_({ ok: false, error: 'stale', message: 'The sheet changed since you opened the editor. Reload to see the latest, then make your change again.' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.keys(TABS).forEach(function (name) {
      var rows = body.tabs[name]; if (!rows) return;
      var sh = ss.getSheetByName(name), cols = TABS[name];
      var data = rows.slice(1).map(function (r) { var out = []; for (var i = 0; i < cols; i++) out.push(r[i] == null ? '' : r[i]); return out; });
      var last = Math.max(sh.getLastRow(), 2);
      sh.getRange(2, 1, last - 1, cols).clearContent();          // keeps the header row, the dropdowns and the formatting
      if (data.length) sh.getRange(2, 1, data.length, cols).setValues(data);
    });
    var next = String(Number(rev_()) + 1);
    PropertiesService.getScriptProperties().setProperty('rev', next);
    return json_({ ok: true, rev: next });
  } finally { lock.releaseLock(); }
}

function readTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = {};
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh) { out[name] = []; return; }
    var rows = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), TABS[name]).getDisplayValues();
    out[name] = rows.filter(function (r, i) { return i === 0 || r.join('') !== ''; });
  });
  return out;
}
function rev_() { return PropertiesService.getScriptProperties().getProperty('rev') || '0'; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
