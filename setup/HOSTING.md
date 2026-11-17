# Putting the site online

The site is plain files. `python3 build.py` makes them in `dist/`; any web host can serve that folder.

## GitHub Pages (set up in this repo)
1. Commit and push to `main` on GitHub.
2. On GitHub: Settings > Pages > Source: **GitHub Actions**. (Free accounts need the repository to be public.)
3. The workflow in `.github/workflows/pages.yml` builds, checks (`tests/check.py`) and publishes on every push. If a check fails nothing is published and the site already online stays as it is; the failed run on GitHub's Actions tab says which check. The address appears under Settings > Pages, usually `https://<account>.github.io/<repo>/`.
4. Put that address in `src/data/site.json` under `site.url`, then push again.

## The hourly rebuild
Once an hour the same workflow reads the owner's sheet and writes its facts (menu, prices, hours, address, phone, links) into the pages themselves, so they are right for search engines, link previews and visitors whose browser cannot reach the sheet. Between rebuilds the browser still reads the sheet on every visit, as before.

- If the sheet cannot be read, or what it holds is incomplete, the site is built from `src/data` instead.
- If a check fails, nothing is published and the site already online stays as it is.
- "Sold out today" and Drafts are never written into the pages.
- GitHub pauses scheduled runs in a repository with no activity for 60 days, and emails the owner first. Any push, or Actions > Publish site > Run workflow, starts them again. The site stays up either way.
- To turn it off, delete the two `schedule:` lines in `.github/workflows/pages.yml`.

## While it is a concept
`site.concept` in `src/data/site.json` is `true`. That puts a line across the top of every page saying this is not the official T/aco site, and tells search engines to stay out. Set it to `false` only when Peter adopts the site.

What keeps search engines out is the `noindex` line in every page. `robots.txt` is only read at the root of a web address, so at `github.io/<repo>/` it has no effect; it starts to count when the site has its own domain. Neither makes a page private: anyone with the address can open it.

## Moving it to tacocolorado.com (later, Peter's decision)
The domain's DNS is his. On GitHub: Settings > Pages > Custom domain, then the DNS records GitHub lists. Set `site.url` to the new address and `site.concept` to `false`.
