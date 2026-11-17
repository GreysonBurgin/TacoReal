#!/usr/bin/env python3
"""Checks the built site before it is published.  python3 tests/check.py   (needs only Python 3; uses Node for two extra tests if it is installed)

A failure stops the publish step, so the site that is already online stays as it is."""
import json, os, re, shutil, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
import build
pages = build.build(); DIST = build.DIST
site = json.load(open(os.path.join(ROOT, 'src', 'data', 'site.json'), encoding='utf-8')); menu = json.load(open(os.path.join(ROOT, 'src', 'data', 'menu.json'), encoding='utf-8'))
files = set(os.listdir(DIST)); bad = []
def check(ok, msg):
    if not ok: bad.append(msg)
base = build.urlparse(site.get('site', {}).get('url', '')).path or '/'
for name in sorted(f for f in files if f.endswith('.html')):
    src = open(os.path.join(DIST, name), encoding='utf-8').read(); public = name[:-5] in pages
    for attr, ref in re.findall(r'\b(href|src|poster)="([^"]+)"', src):
        if re.match(r'https?:|tel:|mailto:|data:|#', ref): continue
        target = ref.split('#')[0].split('?')[0]
        if name == '404.html':
            check(ref.startswith(base), '404.html: %s is not an absolute address' % ref); target = target[len(base):] if target.startswith(base) else target
        check(not target or target in files, '%s: %s points at a file that is not in the site' % (name, ref))
    for img in re.findall(r'<img\b[^>]*>', src):
        check(' alt=' in img, '%s: an image has no alt text: %s' % (name, img[:80])); check(' width=' in img and ' height=' in img, '%s: an image has no width and height: %s' % (name, img[:80]))
    if not public: check('noindex' in src, '%s: the editor must not be indexed' % name); continue
    check(len(re.findall(r'<h1\b', src)) == 1, '%s: needs exactly one main heading' % name)
    foot = src[src.find('<footer class="site-foot"'):]; foot = foot[:foot.find('</footer>')]; check(not re.search(r'<h[1-6]\b', foot), '%s: footer labels must not be headings' % name)
    check('class="skip"' in src, '%s: no skip link' % name)
    if name != '404.html': check('rel="canonical"' in src, '%s: no canonical address' % name)
    if site.get('site', {}).get('concept'):
        check('noindex' in src, '%s: a concept page must not be indexed' % name); check('id="concept"' in src, '%s: the concept line is missing' % name)
    check(site['info']['phone'] in src, '%s: the phone number is not the one in site.json' % name)
    check(site['info']['street'] in src, '%s: the street address is not the one in site.json' % name)
    for key, url in site['links'].items():
        for href in re.findall(r'data-link="%s"[^>]*?href="([^"]*)"' % key, src): check(build.html.unescape(href) == url, '%s: the %s link is not the one in site.json' % (name, key))
m = open(os.path.join(DIST, 'menu.html'), encoding='utf-8').read()
for g in menu['groups']:
    check('id="%s"' % g['id'] in m, 'menu.html: section %s is not in the page' % g['id'])
    for it in g['items']:
        check(build.mesc(it['name']) in m, 'menu.html: %s is not in the page' % it['name'])
        if it.get('price'): check(build.money(it['price']) in m, 'menu.html: the price of %s is not in the page' % it['name'])
check(len({g['id'] for g in menu['groups']}) == len(menu['groups']), 'menu.json: two sections share an id')
home = open(os.path.join(DIST, 'index.html'), encoding='utf-8').read()
ld = json.loads(re.search(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', home, re.S).group(1).replace('<\\/', '</'))
check(ld['telephone'] == site['info']['phone'] and len(ld['openingHoursSpecification']) == sum(1 for h in site['hours'] if not h.get('closed')), 'index.html: the facts for search engines do not match site.json')
check(build.clock(1440, True) == '12 am' and build.clock(720, True) == '12 pm' and build.clock(1290) == '9:30', 'build.py: times are written wrongly')
gs = open(os.path.join(ROOT, 'setup', 'editor-backend.gs'), encoding='utf-8').read()
check("var PASSCODE = 'change-me-before-deploying';" in gs, 'setup/editor-backend.gs: a real passcode must never be saved in the repository')
node = shutil.which('node')
for t in ('backend.test.js', 'sheet.test.js'):
    if not node: print('Node is not installed: skipped tests/%s' % t); continue
    r = subprocess.run([node, os.path.join(ROOT, 'tests', t)], capture_output=True, text=True)
    check(r.returncode == 0, 'tests/%s failed:\n%s' % (t, '\n'.join(l for l in r.stdout.splitlines() if l.startswith('FAIL')) or r.stderr[-400:]))
if bad:
    print('%d problem(s):' % len(bad)); [print(' - ' + b) for b in bad]; sys.exit(1)
print('All checks passed (%d pages).' % len(pages))
