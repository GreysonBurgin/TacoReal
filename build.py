#!/usr/bin/env python3
"""Builds the T/aco site from src/ into dist/.

    python3 build.py            build once
    python3 build.py --serve    build, then serve dist/ at http://localhost:8080 and rebuild when a source file changes

Needs only Python 3. Nothing to install.

src/pages/      one file per page: the part between the header and the footer
src/partials/   the page frame, the header and the footer, written once
src/css/        1-base, 2-footer, 3-phone are joined into site.css; css/pages/ holds each page's own styles
src/js/         ui.js (menus, in-page links), site.js (puts the facts on the page), sheet.js (reads the owner's sheet)
src/data/       site.json and menu.json: every fact that appears in more than one place
src/static/     images, fonts, video; copied as they are
src/editor/     the owner's editor
"""
import hashlib, html, http.server, json, os, re, shutil, sys
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, DIST = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'dist')

def read(*p):
    with open(os.path.join(SRC, *p), encoding='utf-8') as f: return f.read()

def write(name, text):
    with open(os.path.join(DIST, name), 'w', encoding='utf-8') as f: f.write(text)
    return name + '?v=' + hashlib.md5(text.encode()).hexdigest()[:8]     # the ?v= makes browsers fetch a file again when it changes

def front(page_src):
    """Leading <!-- key: value --> lines, then the body, then an optional <!-- scripts --> part."""
    meta = {}
    while True:
        m = re.match(r'\s*<!-- ([a-z]+):(.*?)-->\n?', page_src)
        if not m: break
        meta[m.group(1)] = m.group(2).strip(); page_src = page_src[m.end():]
    body, _, scripts = page_src.partition('<!-- scripts -->')
    return meta, body.rstrip('\n'), scripts.strip()

def image_size(path):
    """Width and height of a .webp or .png, read from its first bytes."""
    with open(path, 'rb') as f: b = f.read(32)
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        kind = b[12:16]
        if kind == b'VP8 ': return int.from_bytes(b[26:28], 'little') & 0x3fff, int.from_bytes(b[28:30], 'little') & 0x3fff
        if kind == b'VP8L': n = int.from_bytes(b[21:25], 'little'); return (n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1
        if kind == b'VP8X': return int.from_bytes(b[24:27], 'little') + 1, int.from_bytes(b[27:30], 'little') + 1
    if b[:8] == b'\x89PNG\r\n\x1a\n': return int.from_bytes(b[16:20], 'big'), int.from_bytes(b[20:24], 'big')
    return None

def size_images(html):
    """Give every <img> its width and height, so the page does not jump as pictures arrive."""
    def fix(m):
        tag = m.group(0); src = re.search(r'src="([^"]+)"', tag)
        if not src or ' width=' in tag: return tag
        path = os.path.join(SRC, 'static', src.group(1)); wh = image_size(path) if os.path.exists(path) else None
        return tag[:-1] + ' width="%d" height="%d" decoding="async">' % wh if wh else tag
    return re.sub(r'<img\b[^>]*>', fix, html)

def esc(s): return str(s).replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')

# ---- the facts, written into the HTML at build time. site.js and the menu script do the same in the browser when the
# ---- owner's sheet has newer facts; these two must stay in step (tests/check.py compares them).
SHORT = {'Sunday': 'Sun', 'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed', 'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat'}

def mins(t):
    m = re.match(r'^(\d{1,2}):(\d{2})$', str(t or '').strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None

def clock(m, ampm=False):
    h, mm = (m // 60) % 24, m % 60; h12 = h % 12 or 12
    return str(h12) + (':%02d' % mm if mm else '') + ((' am' if h < 12 else ' pm') if ampm else '')

def hour_groups(site):
    """Consecutive days with the same hours become one line. None if the week is not seven usable days."""
    week = []
    for r in (site.get('hours') or [])[:7]:
        o, c = mins(r.get('open')), mins(r.get('close'))
        week.append({'day': r['day'], 'closed': bool(r.get('closed')) or o is None or c is None, 'o': o, 'c': c})
    if len(week) != 7: return None
    out = []
    for d in week:
        k = 'x' if d['closed'] else '%s-%s' % (d['o'], d['c'])
        if out and out[-1]['k'] == k: out[-1]['to'] = d['day']
        else: out.append({'k': k, 'from': d['day'], 'to': d['day'], 'd': d})
    return out

def place_facts(page_html, site):
    """Address, phone, links and hours from site.json, wherever the markup asks for them (data-f, data-link, data-hours)."""
    info, links = site.get('info', {}), site.get('links', {})
    tel = 'tel:+1' + re.sub(r'\D', '', str(info.get('phone', '')))
    out = re.sub(r'href="tel:[^"]*"', 'href="%s"' % tel, page_html)
    for key, value in (('phone', info.get('phone')), ('street', info.get('street')), ('city', info.get('city')), ('street-h', (info.get('streetShort') or '') + '.')):
        if value: out = re.sub(r'(<[^>]*data-f="%s"[^>]*>)[^<]*' % key, lambda m: m.group(1) + esc(value), out)
    def link(m): return m.group(1) + esc(links[m.group(2)]) + m.group(3) if links.get(m.group(2)) else m.group(0)
    out = re.sub(r'(<a\b[^>]*data-link="([\w-]+)"[^>]*?href=")[^"]*(")', link, out)
    g = hour_groups(site)
    if g:
        every = len(g) == 1
        short = ''.join('<p>%s · %s</p>' % ('Daily' if every else (SHORT[x['from']] if x['from'] == x['to'] else SHORT[x['from']] + '–' + SHORT[x['to']]),
                        'Closed' if x['d']['closed'] else clock(x['d']['o']) + '–' + clock(x['d']['c'])) for x in g)
        out = re.sub(r'(<div data-hours="short">).*?(</div>)', lambda m: m.group(1) + short + m.group(2), out, flags=re.S)
        long = '\n        '.join('<div data-day-group><dt>%s</dt><dd>%s</dd></div>' % ('Every day' if every else (x['from'] if x['from'] == x['to'] else x['from'] + ' – ' + x['to']),
                        'Closed' if x['d']['closed'] else clock(x['d']['o'], True) + ' – ' + clock(x['d']['c'], True)) for x in g)
        first = [True]
        def group(m):
            if first[0]: first[0] = False; return long
            return ''
        out = re.sub(r'<div data-day-group>.*?</div>(?:\n\s*(?=<div data-day-group>))?', group, out, flags=re.S)
    return out

def money(n): return '$%.2f' % n

def head_price(p):
    d = int(p); c = int(round((p - d) * 100))
    return '<span class="pr">$%d%s</span>' % (d, '<sup>%02d</sup>' % c if c else '')

def mesc(s): return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

SLASH = '<svg class="sl" viewBox="-4 -4 108 166" aria-hidden="true"><polygon class="offset" points="75,5 96,5 26,157 5,157"/><polygon class="face" points="70,0 91,0 21,152 0,152"/></svg>'

def menu_html(menu, checked):
    """The menu as HTML, so the page shows it before (or without) any script. The script in menu.html draws the same thing."""
    jump, out = [], ''
    for g in menu.get('groups', []):
        if g.get('nav'): jump.append('<a href="#%s">%s</a>' % (g['id'], mesc(g['nav'])))
        price = g.get('price')
        out += '<section class="grp" id="%s" aria-labelledby="h-%s"><h2 id="h-%s"%s>%s%s</h2><ul class="items%s">' % (
            g['id'], g['id'], g['id'], ' aria-label="%s, %s each"' % (mesc(g['name']), money(price)) if price else '',
            head_price(price) if price else '', mesc(g['name']), ' compact' if g.get('compact') else '')
        for it in g.get('items', []):
            p = it.get('price') or price; own = (not price) or p != price
            tags = list(it.get('tags') or []) + (['Sold out today'] if it.get('soldOut') else [])
            out += '<li class="it%s%s"><h3>%s%s</h3>%s%s</li>' % (
                ' solo' if it.get('solo') else '', ' out' if it.get('soldOut') else '', mesc(it['name']),
                '<span class="p">%s%s</span>' % ('from ' if it.get('from') else '', money(p)) if own else '',
                '<p class="ds">%s</p>' % mesc(it['desc']) if it.get('desc') else '',
                '<p class="tg">%s</p>' % ' · '.join(mesc(t) for t in tags) if tags else '')
        out += '</ul>%s</section>' % ('<p class="barnote">%s</p>' % mesc(g['note']) if g.get('note') else '')
    out += ('<div class="orn" aria-hidden="true"><i></i></div><p class="fine">All dishes may come into contact with allergens even if not listed as primary ingredients. Please ask us for more information.</p>'
            + ('<p class="fine">Prices last checked %s. Today’s prices and what’s sold out are on Toast.</p>' % mesc(checked) if checked else ''))
    return out, SLASH.join(jump)

def size_data_images(page_html):
    """Pictures a script adds later (data-imgs) carry their width and height too."""
    def fix(m):
        try: imgs = json.loads(html.unescape(m.group(1)))
        except ValueError: return m.group(0)
        for im in imgs:
            path = os.path.join(SRC, 'static', im[0]); wh = image_size(path) if os.path.exists(path) else None
            if wh and len(im) == 2: im.extend(wh)
        return 'data-imgs="%s"' % html.escape(json.dumps(imgs, ensure_ascii=False), quote=True)
    return re.sub(r'data-imgs="([^"]*)"', fix, page_html)

def absolute_links(page_html, base_path):
    """The not-found page is served at whatever address was asked for, so its links and files must not be relative."""
    return re.sub(r'\b(href|src)="(?!https?:|#|tel:|mailto:|data:|/)([^"]+)"', lambda m: '%s="%s%s"' % (m.group(1), base_path, m.group(2)), page_html)

def head_tags(site, page, meta, share):
    """Description, address, share card, icons, and the restaurant's facts in the form search engines read. All from site.json."""
    conf, info = site.get('site', {}), site['info']; base = conf.get('url', '').rstrip('/') + '/'
    here = base + ('' if page == 'index' else page + '.html'); title, d = meta.get('title', 'T/aco'), meta.get('description', '')
    t = ['<meta name="description" content="%s">' % esc(d)] if d else []
    if conf.get('concept') or page == '404': t.append('<meta name="robots" content="noindex, nofollow">')
    if page != '404': t.append('<link rel="canonical" href="%s">' % esc(here))
    t += ['<meta property="og:type" content="website">', '<meta property="og:site_name" content="%s">' % esc(info.get('name', 'T/aco')),
          '<meta property="og:title" content="%s">' % esc(title), '<meta property="og:description" content="%s">' % esc(d), '<meta property="og:url" content="%s">' % esc(here)]
    if share: t += ['<meta property="og:image" content="%s%s">' % (esc(base), share), '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta name="twitter:card" content="summary_large_image">']
    t += ['<link rel="icon" href="favicon.ico" sizes="32x32">', '<link rel="icon" href="favicon.svg" type="image/svg+xml">', '<link rel="apple-touch-icon" href="apple-touch-icon.png">', '<meta name="theme-color" content="#fbf4e8">']
    if page == 'index':
        ld = {'@context': 'https://schema.org', '@type': 'Restaurant', 'name': info.get('name', 'T/aco'), 'url': base, 'telephone': info['phone'],
              'address': {'@type': 'PostalAddress', 'streetAddress': info['street'], 'addressLocality': info.get('locality', ''), 'addressRegion': info.get('region', ''), 'postalCode': info.get('postalCode', ''), 'addressCountry': 'US'},
              'menu': base + 'menu.html', 'acceptsReservations': site['links'].get('reservations', ''),
              'openingHoursSpecification': [{'@type': 'OpeningHoursSpecification', 'dayOfWeek': h['day'], 'opens': h['open'], 'closes': h['close']} for h in site['hours'] if not h.get('closed')]}
        if share: ld['image'] = base + share
        t.append('<script type="application/ld+json" id="ld">%s</script>' % json.dumps(ld, ensure_ascii=False).replace('</', '<\\/'))
    return t

def build():
    os.makedirs(DIST, exist_ok=True)
    left = []
    for old in os.listdir(DIST):                      # start clean, folders included
        path = os.path.join(DIST, old)
        try: shutil.rmtree(path) if os.path.isdir(path) and not os.path.islink(path) else os.remove(path)
        except OSError: left.append(old)
    for folder in ('static', 'editor'):
        for f in sorted(os.listdir(os.path.join(SRC, folder))):
            if f.startswith('.'): continue
            if folder == 'editor' and f.endswith('.html'): write(f, size_images(read(folder, f)))
            else: shutil.copyfile(os.path.join(SRC, folder, f), os.path.join(DIST, f))

    site, menu = load_data()
    url = {
        'site-data.js': write('site-data.js', '/* Made by build.py from src/data/site.json. Edit that file, not this one. */\nwindow.TACO_SITE = ' + json.dumps(site, indent=2, ensure_ascii=False) + ';\n'),
        'menu-data.js': write('menu-data.js', '/* Made by build.py from src/data/menu.json. Edit that file, not this one. */\nwindow.TACO_MENU = ' + json.dumps(menu, indent=2, ensure_ascii=False) + ';\n'),
        'site.css': write('site.css', '\n'.join(read('css', f) for f in sorted(os.listdir(os.path.join(SRC, 'css'))) if f.endswith('.css'))),
    }
    for f in ('ui.js', 'site.js', 'sheet.js'): url[f] = write(f, read('js', f))

    conf = site.get('site', {}); share = 'share.jpg' if os.path.exists(os.path.join(SRC, 'static', 'share.jpg')) else ''
    frame, header, footer = read('partials', 'page.html'), read('partials', 'header.html').strip(), read('partials', 'footer.html').strip()
    base_path = urlparse(conf.get('url', '')).path or '/'
    if not base_path.endswith('/'): base_path += '/'
    menu_body, menu_jump = menu_html(menu, site.get('pricesChecked'))
    pages = sorted(f[:-5] for f in os.listdir(os.path.join(SRC, 'pages')) if f.endswith('.html'))
    for page in pages:
        meta, main, own = front(read('pages', page + '.html'))
        file = page + '.html'
        h = header.replace('href="%s"' % file, 'href="%s" aria-current="page"' % file)
        f = footer
        if page == 'index': h, f = h.replace('href="index.html#', 'href="#'), f.replace('href="index.html#', 'href="#')
        css = os.path.join('css', 'pages', meta.get('css', page) + '.css')
        page_css = write('page-%s.css' % meta.get('css', page), read(css)) if os.path.exists(os.path.join(SRC, css)) else ''
        scripts = ['<script src="%s"></script>' % url['site-data.js']]
        scripts += ['<script src="%s"></script>' % url[s] for s in meta.get('load', '').split()]
        if own: scripts.append(own)
        scripts += ['<script src="%s"></script>' % url['ui.js'], '<script src="%s" defer></script>' % url['site.js'], '<script src="%s" defer></script>' % url['sheet.js']]
        head = head_tags(site, page, meta, share)
        if conf.get('concept'):
            note = '<div id="concept" role="note">%s <a href="%s">The official site<span aria-hidden="true"> ↗</span></a></div>\n  ' % (esc(conf.get('conceptText', 'A design concept.')), esc(conf.get('officialUrl', '#')))
            h = note + h
        out = frame
        for k, v in (('title', meta.get('title', 'T/aco')), ('meta', '\n'.join(head)), ('site.css', url['site.css']), ('page.css', page_css), ('page', page),
                     ('header', h), ('main', main), ('footer', f), ('scripts', '\n'.join(scripts))):
            out = out.replace('{{%s}}' % k, v)
        if not page_css: out = out.replace('<link rel="stylesheet" href="">\n', '')
        out = out.replace('{{menu.html}}', menu_body).replace('{{menu.jump}}', menu_jump)
        out = size_data_images(size_images(place_facts(re.sub(r'\n{3,}', '\n\n', out), site)))
        if page == '404': out = absolute_links(out, base_path)
        write(file, out)
    live = [p for p in pages if p != '404']; base = conf.get('url', '').rstrip('/') + '/'
    open_to_search = not conf.get('concept')
    write('robots.txt', 'User-agent: *\n' + ('Allow: /\nSitemap: %ssitemap.xml\n' % base if open_to_search else 'Disallow: /\n'))
    write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + ''.join('  <url><loc>%s%s</loc></url>\n' % (base, '' if p == 'index' else p + '.html') for p in live) + '</urlset>\n')
    stale = [f for f in left if not os.path.exists(os.path.join(SRC, 'static', f)) and not os.path.exists(os.path.join(SRC, 'editor', f))
             and f not in url and f not in ('robots.txt', 'sitemap.xml') and not f.startswith('page-') and f[:-5] not in pages]
    if stale: sys.exit('Old files could not be removed from dist/ and would be published: %s. Delete the dist folder and build again.' % ', '.join(stale))
    return pages

def usable(facts):
    """True if facts read from the owner's sheet are complete enough to write into the pages."""
    try:
        info, links, hours = facts['info'], facts['links'], facts['hours']
        if not (info.get('phone') and info.get('street') and info.get('city') and info.get('streetShort')): return False
        if not all(re.match(r'https?://\S+$', str(v)) for v in links.values()) or not links: return False
        if len(hours) != 7 or [h['day'] for h in hours] != list(SHORT): return False
        if not all(h.get('closed') or (mins(h.get('open')) is not None and mins(h.get('close')) is not None) for h in hours): return False
        for g in facts.get('menu', {}).get('groups', []):
            if not (re.match(r'[a-z0-9-]+$', g['id']) and g['name'] and g['items']): return False
            for it in g['items']:
                p = it.get('price') or g.get('price')
                if not it.get('name') or not isinstance(p, (int, float)) or p < 0: return False
        return True
    except (KeyError, TypeError, AttributeError): return False

def load_data():
    """site.json and menu.json; with TACO_FACTS set (the scheduled rebuild), the owner's sheet is laid over them if it is usable."""
    site = json.loads(read('data', 'site.json')); menu = json.loads(read('data', 'menu.json'))
    path = os.environ.get('TACO_FACTS')
    if path:
        try:
            with open(path, encoding='utf-8') as f: facts = json.load(f)
        except (OSError, ValueError): facts = None
        if facts and usable(facts):
            site['info'].update({k: facts['info'][k] for k in ('street', 'streetShort', 'city', 'phone')})
            site['links'].update(facts['links']); site['hours'] = facts['hours']
            if facts.get('pricesChecked'): site['pricesChecked'] = facts['pricesChecked']
            groups = facts.get('menu', {}).get('groups')
            if groups:
                for g in groups:
                    for it in g['items']: it.pop('soldOut', None)     # "sold out today" is only ever shown live, never baked in
                menu['groups'] = groups
            print('Facts from the owner\'s sheet were written into the pages.')
        else: print('The sheet\'s facts were not usable; built from src/data instead.')
    return site, menu

def newest():
    return max(os.path.getmtime(os.path.join(d, f)) for d, _, fs in os.walk(SRC) for f in fs)

if __name__ == '__main__':
    pages = build(); print('Built %d pages into dist/' % len(pages))
    if '--serve' in sys.argv:
        port = 8080; built = [newest()]
        BASE = urlparse(json.loads(read('data', 'site.json')).get('site', {}).get('url', '')).path or '/'
        if not BASE.endswith('/'): BASE += '/'
        class H(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k): super().__init__(*a, directory=DIST, **k)
            def do_GET(self):
                if newest() > built[0]: build(); built[0] = newest()
                if BASE != '/' and self.path.startswith(BASE): self.path = '/' + self.path[len(BASE):]   # the site's own address, e.g. /TacoReal/
                super().do_GET()
            def send_error(self, code, message=None, explain=None):
                page = os.path.join(DIST, '404.html')
                if code != 404 or not os.path.exists(page): return super().send_error(code, message, explain)
                body = open(page, 'rb').read()
                self.send_response(404); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            def log_message(self, *a): pass
        print('Serving http://localhost:%d  (Ctrl-C to stop). Source changes rebuild on the next page load.' % port)
        http.server.ThreadingHTTPServer(('', port), H).serve_forever()
