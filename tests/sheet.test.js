// Runs src/js/sheet.js (the part that turns the owner's sheet into facts for the page) with stand-ins for the browser.
//   node tests/sheet.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sheet.js'), 'utf8');
const site = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'site.json'), 'utf8'));
const H = { Menu: ['Status', 'Section', 'Item', 'Description', 'Price', 'Starts at', 'Note'], Sections: ['Section', 'Heading on the site', 'Price for every item', 'In the quick links', 'Layout', 'Note under the section'], Hours: ['Day', 'Opens', 'Closes', 'Closed all day'], Info: ['Setting', 'Value', 'Where it shows'] };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function tabs(change) {
  const t = { Menu: [H.Menu, ['Live', 'Tacos', 'Carnitas', 'Pork', '$5.95', '', ''], ['Live', 'Fork & knife', 'Quesadilla', '', '11.75', '', '']],
    Sections: [H.Sections, ['Tacos', 'Tacos', '', 'Yes', 'Standard', ''], ['Fork & knife', 'Fork & knife', '', 'Yes', 'Standard', '']],
    Hours: [H.Hours].concat(DAYS.map(d => [d, '11:00 AM', '9:00 PM', ''])), Info: [H.Info, ['Phone', '(303) 443-9468', '']] };
  if (change) change(t); return t;
}
function run(t) {   // as a preview opened from the editor: the tabs are handed over in the browser's storage
  let shown = null; const store = { 'taco-draft': JSON.stringify(t) }, sess = {};
  const el = () => ({ setAttribute() {}, appendChild() {}, style: {} });
  const win = { TACO_SITE: site, TACO_APPLY: d => { shown = d; }, console: { warn() {} } }; win.top = win;
  const ctx = { window: win, location: { search: '?preview=draft', pathname: '/menu.html' }, document: { getElementById: () => null, createElement: el, body: el() },
    sessionStorage: { getItem: k => sess[k] || null, setItem: (k, v) => { sess[k] = v; } }, localStorage: { getItem: k => store[k] || null, setItem() {} }, fetch: () => { throw new Error('no network in tests'); }, Promise, JSON, Date };
  vm.createContext(ctx); vm.runInContext(src, ctx); return shown;
}
let failed = 0; const ok = (n, c) => { if (!c) { failed++; console.log('FAIL  ' + n); } else console.log('ok    ' + n); };

let d = run(tabs());
ok('a plain sheet gives a menu and seven days', d && d.menu.groups.length === 2 && d.hours.length === 7);
ok('section ids come from section names', d.menu.groups[0].id === 'tacos' && d.menu.groups[1].id === 'fork-knife');
ok('prices with or without a dollar sign are read', d.menu.groups[0].items[0].price === 5.95 && d.menu.groups[1].items[0].price === 11.75);

d = run(tabs(t => { t.Menu[1][0] = 'Hidden'; t.Menu[2][0] = 'Hidden'; }));
ok('every item hidden: the menu is shown as empty, not left as it was', d && d.menu && d.menu.groups.length === 0);
d = run(tabs(t => { t.Menu = [H.Menu]; }));
ok('a Menu tab with no rows changes nothing on the page', d && d.menu === undefined);

d = run(tabs(t => { t.Menu[1][4] = '-5.00'; }));
ok('a negative price is not read as a positive one', d.menu.groups.every(g => g.items.every(i => i.name !== 'Carnitas')));

d = run(tabs(t => { t.Hours[6][2] = '12:00 AM'; t.Hours[5][2] = '1:00 AM'; }));
ok('midnight closing is kept as the end of the day', d.hours[5].close === '24:00');
ok('closing after midnight is kept', d.hours[4].close === '01:00');
d = run(tabs(t => { t.Hours[2][2] = ''; }));
ok('a half-filled Hours tab never reaches the page', JSON.stringify(d.hours) === JSON.stringify(site.hours));
d = run(tabs(t => { t.Info.push(['Order online link', 'javascript:alert(1)', '']); }));
ok('a link that is not a web address is not used', d.links.order === site.links.order);
d = run(tabs(t => { t.Sections.push(['Tacos!', 'Tacos again', '', 'No', 'Standard', '']); t.Menu.push(['Live', 'Tacos!', 'Duck', '', '6.50', '', '']); }));
ok('two sections never share an id', new Set(d.menu.groups.map(g => g.id)).size === d.menu.groups.length);

console.log(failed ? failed + ' failed' : 'all passed'); process.exit(failed ? 1 : 0);
