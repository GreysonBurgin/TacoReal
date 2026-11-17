# Putting the site online

The site is plain files. `python3 build.py` makes them in `dist/`; any web host can serve that folder.

## GitHub Pages (set up in this repo)
1. Commit and push to `main` on GitHub.
2. On GitHub: Settings > Pages > Source: **GitHub Actions**. (Free accounts need the repository to be public.)
3. The workflow in `.github/workflows/pages.yml` builds and publishes on every push. The address appears under Settings > Pages, usually `https://<account>.github.io/<repo>/`.
4. Put that address in `src/data/site.json` under `site.url`, then push again.

## While it is a concept
`site.concept` in `src/data/site.json` is `true`. That puts a line across the top of every page saying this is not the official T/aco site, and tells search engines to stay out. Set it to `false` only when Peter adopts the site.

## Moving it to tacocolorado.com (later, Peter's decision)
The domain's DNS is his. On GitHub: Settings > Pages > Custom domain, then the DNS records GitHub lists. Set `site.url` to the new address and `site.concept` to `false`.
