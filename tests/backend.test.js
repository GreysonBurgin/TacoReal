// Runs setup/editor-backend.gs against stand-ins for Google's services. No network, nothing real is touched.
//   node tests/backend.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, '..', 'setup', 'editor-backend.gs'), 'utf8');
const HEAD = { Menu: ['Status', 'Section', 'Item', 'Description', 'Price', 'Starts at', 'Note'], Sections: ['Section', 'Heading on the site', 'Price for every item', 'In the quick links', 'Layout', 'Note under the section'], Hours: ['Day', 'Opens', 'Closes', 'Closed all day'], Info: ['Setting', 'Value', 'Where it shows'] };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function world(opts) {
  opts = opts || {};
  const data = {};   // tab -> rows of strings
  const fresh = () => ({
    Menu: [HEAD.Menu, ['Live', 'Tacos', 'Carnitas', 'Pork', '5.95', '', ''], ['Draft', 'Tacos', 'Next month', 'Secret', '7', '', ''], ['Hidden', 'Tacos', 'Old one', '', '6', '', '']],
    Sections: [HEAD.Sections, ['Tacos', 'Tacos', '', 'Yes', 'Standard', '']],
    Hours: [HEAD.Hours].concat(DAYS.map(d => [d, '11:00 AM', '9:00 PM', ''])),
    Info: [HEAD.Info, ['Phone', '(303) 443-9468', ''], ['Order online link', 'https://example.com/order', '']]
  });
  Object.assign(data, JSON.parse(JSON.stringify(fresh())));
  if (opts.missing) delete data[opts.missing];
  let failOn = opts.failOn, cache = {}, slept = 0;
  const sheet = name => ({
    getLastRow: () => data[name].length,
    getRange: (r, c, n, cols) => ({
      getDisplayValues: () => data[name].slice(r - 1, r - 1 + n).map(row => { const o = []; for (let i = 0; i < cols; i++) o.push(String(row[i] == null ? '' : row[i])); return o; }),
      clearContent: () => { data[name] = data[name].slice(0, r - 1); },
      setValues: v => { if (failOn === name) { failOn = null; throw new Error('service error'); } data[name] = data[name].slice(0, r - 1).concat(v.map(row => row.map(x => String(x)))); }
    })
  });
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => data[n] ? sheet(n) : null, insertSheet: n => { data[n] = []; return sheet(n); } }), flush: () => {} },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: { sleep: ms => { slept += ms; }, DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' }, computeDigest: (a, s) => Array.from(crypto.createHash('md5').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => s }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) }
  };
  vm.createContext(ctx); vm.runInContext(src.replace("var PASSCODE = 'change-me-before-deploying';", "var PASSCODE = 'a-long-test-passcode';"), ctx);
  const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }));
  return { data, ctx, post, get: () => JSON.parse(ctx.doGet()), slept: () => slept, breakNext: n => { failOn = n; }, P: 'a-long-test-passcode' };
}
let failed = 0;
function ok(name, cond) { if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name); }
const clone = o => JSON.parse(JSON.stringify(o));

// 1. what anyone can read leaves out Drafts and Hidden; the passcode shows everything
{ const w = world(), pub = w.get(), all = w.post({ action: 'read', passcode: w.P });
  ok('open read hides Draft and Hidden rows', pub.tabs.Menu.length === 2 && pub.tabs.Menu[1][2] === 'Carnitas');
  ok('passcode read returns every row', all.ok && all.tabs.Menu.length === 4);
  ok('both reads carry the same fingerprint', pub.rev === all.rev && /^[0-9a-f]{32}$/.test(pub.rev)); }

// 2. a save that fails part-way puts everything back and says nothing changed
{ const w = world(), all = w.post({ action: 'read', passcode: w.P }), before = clone(w.data), tabs = clone(all.tabs);
  tabs.Menu[1][4] = 6.25; w.breakNext('Hours');
  const r = w.post({ action: 'write', passcode: w.P, rev: all.rev, tabs, full: true });
  ok('failed save reports failure', !r.ok && r.error === 'failed');
  ok('failed save leaves the sheet as it was', JSON.stringify(w.data) === JSON.stringify(before)); }

// 3. a normal save works, and the fingerprint moves
{ const w = world(), all = w.post({ action: 'read', passcode: w.P }), tabs = clone(all.tabs); tabs.Menu[1][4] = 6.25;
  const r = w.post({ action: 'write', passcode: w.P, rev: all.rev, tabs, full: true });
  ok('save succeeds', r.ok && r.rev !== all.rev && w.data.Menu[1][4] === '6.25');
  ok('Drafts and Hidden survive a save', w.data.Menu.length === 4);
  const again = w.post({ action: 'write', passcode: w.P, rev: all.rev, tabs, full: true });
  ok('saving again from the old copy is refused as stale', !again.ok && again.error === 'stale'); }

// 4. an edit made in the sheet by hand is not overwritten
{ const w = world(), all = w.post({ action: 'read', passcode: w.P }); w.data.Info[1][1] = '(303) 000-0000';
  const r = w.post({ action: 'write', passcode: w.P, rev: all.rev, tabs: clone(all.tabs), full: true });
  ok('hand edit in the sheet makes the editor copy stale', !r.ok && r.error === 'stale' && w.data.Info[1][1] === '(303) 000-0000'); }

// 5. an editor page that never saw the Drafts cannot save
{ const w = world(), pub = w.get(), before = clone(w.data);
  const r = w.post({ action: 'write', passcode: w.P, rev: pub.rev, tabs: clone(pub.tabs) });
  ok('old editor page is refused', !r.ok && r.error === 'old editor' && JSON.stringify(w.data) === JSON.stringify(before)); }

// 6. nothing is written when any part is wrong
{ const w = world(), all = w.post({ action: 'read', passcode: w.P }), before = clone(w.data);
  const bad = (name, change) => { const tabs = clone(all.tabs); change(tabs); const r = w.post({ action: 'write', passcode: w.P, rev: all.rev, tabs, full: true });
    ok('refused: ' + name, !r.ok && r.error === 'invalid' && /Nothing was changed/.test(r.message) && JSON.stringify(w.data) === JSON.stringify(before)); };
  bad('negative price', t => { t.Menu[1][4] = '-5.00'; });
  bad('price with letters', t => { t.Menu[1][4] = 'five'; });
  bad('unknown status', t => { t.Menu[1][0] = 'Gone'; });
  bad('link that is not a web address', t => { t.Info[2][1] = 'javascript:alert(1)'; });
  bad('a day missing from the hours', t => { t.Hours.pop(); });
  bad('a day with no closing time', t => { t.Hours[3][2] = ''; });
  bad('a missing tab in the save', t => { delete t.Sections; });
  const w2 = world({ missing: 'Hours' }), a2 = w2.post({ action: 'read', passcode: w2.P }), t2 = clone(a2.tabs); t2.Hours = [HEAD.Hours].concat(DAYS.map(d => [d, '11:00 AM', '9:00 PM', '']));
  const b2 = clone(w2.data), r2 = w2.post({ action: 'write', passcode: w2.P, rev: a2.rev, tabs: t2, full: true });
  ok('refused: the sheet has lost a tab', !r2.ok && r2.error === 'missing tab' && JSON.stringify(w2.data) === JSON.stringify(b2)); }

// 7. guessing cannot lock the owner out
{ const w = world(); let wrong = 0; for (let i = 0; i < 12; i++) if (w.post({ action: 'check', passcode: 'guess' + i }).error === 'passcode') wrong++;
  ok('wrong passcodes are refused', wrong === 12);
  ok('wrong passcodes are slowed after eight', w.slept() >= 3000 * 4);
  ok('the right passcode still works after many wrong ones', w.post({ action: 'check', passcode: w.P }).ok === true);
  ok('an empty or missing passcode is refused', !w.post({ action: 'check' }).ok && !w.post({ action: 'check', passcode: '' }).ok); }

// 8. text that looks like a formula is stored as text; setUp adds missing tabs
{ const w = world(), all = w.post({ action: 'read', passcode: w.P }), tabs = clone(all.tabs); tabs.Menu[1][3] = '=IMPORTXML("http://x")';
  w.post({ action: 'write', passcode: w.P, rev: all.rev, tabs, full: true });
  ok('formula-like text is stored as text', w.data.Menu[1][3].charAt(0) === "'");
  const w3 = world({ missing: 'Info' }); w3.ctx.setUp(); ok('setUp adds a missing tab with its header', w3.data.Info.length === 1 && w3.data.Info[0][0] === 'Setting'); }

console.log(failed ? failed + ' failed' : 'all passed'); process.exit(failed ? 1 : 0);
