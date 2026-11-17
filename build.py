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
import hashlib, http.server, json, os, re, shutil, sys

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

def head_tags(site, page, meta, share):
    """Description, address, share card, icons, and the restaurant's facts in the form search engines read. All from site.json."""
    conf, info = site.get('site', {}), site['info']; base = conf.get('url', '').rstrip('/') + '/'
    here = base + ('' if page == 'index' else page + '.html'); title, d = meta.get('title', 'T/aco'), meta.get('description', '')
    t = ['<meta name="description" content="%s">' % esc(d)] if d else []
    if conf.get('concept') or page == '404': t.append('<meta name="robots" content="noindex, nofollow">')
    else: t.append('<link rel="canonical" href="%s">' % esc(here))
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
        t.append('<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False).replace('</', '<\\/'))
    return t

def build():
    os.makedirs(DIST, exist_ok=True)
    for old in os.listdir(DIST):                      # start clean; skip quietly where deleting is not allowed
        try: os.remove(os.path.join(DIST, old))
        except OSError: pass
    for folder in ('static', 'editor'):
        for f in sorted(os.listdir(os.path.join(SRC, folder))):
            if not f.startswith('.'): shutil.copyfile(os.path.join(SRC, folder, f), os.path.join(DIST, f))

    site = json.loads(read('data', 'site.json')); menu = json.loads(read('data', 'menu.json'))
    url = {
        'site-data.js': write('site-data.js', '/* Made by build.py from src/data/site.json. Edit that file, not this one. */\nwindow.TACO_SITE = ' + json.dumps(site, indent=2, ensure_ascii=False) + ';\n'),
        'menu-data.js': write('menu-data.js', '/* Made by build.py from src/data/menu.json. Edit that file, not this one. */\nwindow.TACO_MENU = ' + json.dumps(menu, indent=2, ensure_ascii=False) + ';\n'),
        'site.css': write('site.css', '\n'.join(read('css', f) for f in sorted(os.listdir(os.path.join(SRC, 'css'))) if f.endswith('.css'))),
    }
    for f in ('ui.js', 'site.js', 'sheet.js'): url[f] = write(f, read('js', f))

    conf = site.get('site', {}); share = 'share.jpg' if os.path.exists(os.path.join(SRC, 'static', 'share.jpg')) else ''
    frame, header, footer = read('partials', 'page.html'), read('partials', 'header.html').strip(), read('partials', 'footer.html').strip()
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
        out = size_images(re.sub(r'\n{3,}', '\n\n', out))
        write(file, out)
    live = [p for p in pages if p != '404']; base = conf.get('url', '').rstrip('/') + '/'
    open_to_search = not conf.get('concept')
    write('robots.txt', 'User-agent: *\n' + ('Allow: /\nSitemap: %ssitemap.xml\n' % base if open_to_search else 'Disallow: /\n'))
    write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + ''.join('  <url><loc>%s%s</loc></url>\n' % (base, '' if p == 'index' else p + '.html') for p in live) + '</urlset>\n')
    return pages

def newest():
    return max(os.path.getmtime(os.path.join(d, f)) for d, _, fs in os.walk(SRC) for f in fs)

if __name__ == '__main__':
    pages = build(); print('Built %d pages into dist/' % len(pages))
    if '--serve' in sys.argv:
        port = 8080; built = [newest()]
        class H(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k): super().__init__(*a, directory=DIST, **k)
            def do_GET(self):
                if newest() > built[0]: build(); built[0] = newest()
                super().do_GET()
            def log_message(self, *a): pass
        print('Serving http://localhost:%d  (Ctrl-C to stop). Source changes rebuild on the next page load.' % port)
        http.server.ThreadingHTTPServer(('', port), H).serve_forever()
