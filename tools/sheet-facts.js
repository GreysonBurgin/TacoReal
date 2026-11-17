// Reads the owner's sheet the way the website does and prints its facts as JSON, for build.py to write into the pages.
//   node tools/sheet-facts.js > facts.json
// Uses src/js/sheet.js itself, so the build and the browser can never read the sheet differently.
// Prints nothing and exits 1 if the sheet cannot be read; the build then uses the facts in src/data as usual.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'site.json'), 'utf8'));
const api = (site.sheet || {}).api;
function facts(tabs) {
  let shown = null; const store = { 'taco-draft': JSON.stringify(tabs) }, sess = {};
  const el = () => ({ setAttribute() {}, appendChild() {}, style: {} });
  const win = { TACO_SITE: site, TACO_APPLY: d => { shown = d; }, console: { warn() {} } }; win.top = win;
  const ctx = { window: win, location: { search: '?preview=draft', pathname: '/' }, document: { getElementById: () => null, createElement: el, body: el() },
    sessionStorage: { getItem: k => sess[k] || null, setItem: (k, v) => { sess[k] = v; } }, localStorage: { getItem: k => store[k] || null, setItem() {} }, Promise, JSON, Date };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'src', 'js', 'sheet.js'), 'utf8'), ctx);
  return shown;
}
module.exports = facts;
if (require.main === module) {
  if (!api) { console.error('No sheet is connected in site.json.'); process.exit(1); }
  const timer = setTimeout(() => { console.error('The sheet did not answer in time.'); process.exit(1); }, 45000);
  fetch(api, { redirect: 'follow' }).then(r => { if (!r.ok) throw new Error('the sheet answered ' + r.status); return r.json(); })
    .then(j => { if (!j || !j.ok || !j.tabs) throw new Error('the sheet sent no data');
      const d = facts(j.tabs); if (!d) throw new Error('the sheet could not be read');
      // only rows that are on the website: a Draft never reaches the built pages, whichever version of the sheet script answered
      const live = { Menu: j.tabs.Menu.filter((r, i) => i === 0 || /^(live|sold out)?$/i.test(String(r[0] || '').trim())) };
      const pub = facts(Object.assign({}, j.tabs, live));
      clearTimeout(timer); process.stdout.write(JSON.stringify(pub)); })
    .catch(e => { console.error('Sheet not read: ' + e.message); process.exit(1); });
}
