# First Search Console export

Web search, property `dsh.fish`, filter "Last 3 months". The origin had no
impressions before 13 August 2026. Almost all of the 464 impressions and all
13 clicks landed on 20 August, which is an indexation burst, not a traffic
trend. Treat every rate below as a first look, not a baseline.

## Totals

| Slice | Clicks | Impressions | CTR | Avg. position |
|---|---|---|---|---|
| Origin | 13 | 464 | 2.8% | ~6 |
| Desktop | 13 | 341 | 3.8% | 7.5 |
| Mobile | 0 | 123 | 0% | 3.3 |
| South Korea | 0 | 88 | 0% | 2.1 |
| United States | 2 | 118 | 1.7% | 7.1 |
| Singapore | 4 | 41 | 9.8% | 6.1 |

Search Appearance was empty. No rich result, sitelink or FAQ impression was
recorded. The `SoftwareApplication` node is already emitted; Google has not
chosen to show it.

## What the clicks were

Every click was a single-digit hit on a plugin URL the searcher already knew
the name of: `/a/dsh-browser-control`, `/a/dsh-crew`, `/a/deepseek-harness-auth`,
and nine similar rows. Desktop, mixed countries, positions 1–6. That is
navigational demand for package names, and it is the only thing converting.

The query export does not list those click queries. It lists the *impression*
leaders, all at 0% CTR: `dsh-free-search`, a quoted npm spec, `dsh-codex-connect`,
`dsh plugin market`, `dsh`. Brand-generic `dsh` sat at position 58. No
informational query (`how to install`, `write a skill`, `dsh cli`) appears at
all, and no `/docs` URL appears in the page report.

## Why position two did not get clicked

Three rows describe the same miss:

| Row | Clicks | Impressions | Position |
|---|---|---|---|
| `/a/dsh-better-edit` | 0 | 87 | 2.17 |
| South Korea | 0 | 88 | 2.12 |
| Mobile | 0 | 123 | 3.28 |

The English plugin URL is being shown to Korean mobile searchers at position
two, and nobody is clicking it. The Korean alternate
(`/ko/a/dsh-better-edit`) had one impression. `hreflang` is in the page and the
sitemap; the cluster has not been processed yet. Until it is, Google falls
through to the English document.

The title that document shipped was `dsh-better-edit — Bundle · dsh.fish`.
On a Korean result that reads as an English kebab-case slug, a taxonomy word,
and a site name Google already prints on its own line. The description
("Hash-anchored read/edit/undo tools…") was the useful sentence and sat below
the fold of a mobile snippet. Kind labels in the title are now dropped; the
title is `{name} — {summary}`, clamped to 60 characters, so the Korean page
leads with the translated summary instead of `번들`.

A 32×32 favicon was the only icon in `<head>`. Google Search ignores favicons
smaller than 48×48, so the result also had no brand glyph on mobile. 48×48 and
96×96 derivatives of `whale-brand.png` are now declared next to it.

## Residual URLs, not missing redirects

`http://dsh.fish/` still has 23 impressions against 14 for `https://dsh.fish/`.
The HTTP URL already 301s to HTTPS at the edge and the Worker sends HSTS.
Retired prefixes `/fr`, `/de`, `/es` still show a handful of impressions and
already 301 onto English. Do not add a second redirect. Request indexing of
the HTTPS home, `/browse`, `/docs`, and `/ko/a/dsh-better-edit`, and wait for
the old URLs to drop out of the page report.

## Crawl budget

Five artifact sitemaps are live. In the first week Google spent the burst on
plugin URLs, including locale variants of long-tail rows, and did not fetch a
single `/docs` page. That matches the query mix: package names, not guides.

`SEO_LOCALE_GATING` stays off until the Korean cluster is associated. Gating
now would `noindex` incomplete translations and leave the English URL as the
only thing Korea can be shown.

## Operator follow-up

1. Search Console → URL Inspection on `https://dsh.fish/`, `/browse`, `/docs`,
   `/ko/a/dsh-better-edit`. Request indexing. Check the International Targeting
   report for `hreflang` errors.
2. After the next crawl, compare CTR on `/a/dsh-better-edit` and on South
   Korea. Those two numbers are the test of the title and favicon change.
3. Do not enable `SEO_LOCALE_GATING` on the back of this export.
4. Do not treat position 58 for `dsh` as a title bug. The harness repository
   owns that query; this origin should win `dsh plugin` / `dsh plugin hub`.
   `/browse` is already titled for that and sat at position 2.4 with five
   impressions.

The backlog that follows from this export is in
[`recommendations.md`](recommendations.md).

---

# Coverage export, 27 August 2026

Pages report, property `dsh.fish`, sitemap "All known pages". Chart through
21 August (typical reporting delay). This is the inventory counterpart of the
traffic export above.

## Totals

| Slice | Pages |
|---|---|
| Indexed | 2,445 |
| Not indexed | 118,540 |
| Impressions (21 Aug) | 735 |

The jump on 18 August — 11 indexed / 3 not indexed the day before, then 2,445 /
118,540 — is the sitemap being ingested, not a traffic trend. Impressions then
grew 17 → 735 over three days **without** more URLs entering the index: Google
spent the rest of the budget elsewhere.

Live catalog at the time of the reading: 5,985 artifacts. Sitemap invitation:

| File | `<loc>` count |
|---|---|
| `/sitemaps/pages.xml` | 264 |
| `/sitemaps/artifacts/0.xml` … `4.xml` | 6,000 each (1,000 artifacts × 6 locales) |
| `/sitemaps/artifacts/5.xml` | 5,910 |
| **Offered** | **~36,174** |

GSC knew ~120,985 URLs. The extra ~85k were not in the sitemap.

## Why the extra URLs were `noindex`

| Reason | Source | Pages |
|---|---|---|
| Excluded by `noindex` tag | Website | 103,428 |
| Discovered – currently not indexed | Google systems | 12,919 |
| Server error (5xx) | Website | 1,306 |
| Crawled – currently not indexed | Google systems | 853 |
| Not found (404) | Website | 20 |
| Page with redirect | Website | 12 |
| Soft 404 | Website | 1 |
| Duplicate, Google chose different canonical | Google systems | 1 |

Production HTML for `/ja/a/dsh-better-edit` is `index, follow` with
`SEO_LOCALE_GATING=false`. The 103k `noindex` rows are not untranslated plugin
pages. They match the URL classes that already emit `noindex, follow`:

- `/browse?q=<keyword>` from the twelve keyword chips on each plugin page
  (`rel="nofollow"` is a hint; Google still fetched them)
- `/browse?offset=`, `/kind/…?offset=`, `/category/…?offset=`
- other query views (`?sort=`, `?profile=`, combined filters)

~5,985 artifacts × up to 12 keywords, plus locale-prefixed copies and
pagination, is the right order of magnitude. Each fetch is a D1 search. A
wave of 100k of those is also the 1,306 5xx: the origin was saturating, not
returning a broken document.

The 12,919 "discovered, not indexed" and the 853 "crawled, not indexed" are
the leftover **wanted** URLs — sitemap plugin pages waiting because the budget
went to the `noindex` views. Locale shells with English README body and a
translated frame are a quality reason some crawled pages stay out; do not
turn on `SEO_LOCALE_GATING` until the Korean cluster from the first export
is associated.

12 redirects (HTTP, `/en/`, retired `/de` `/fr` `/es` `/pt-BR`) and 20 404s
are residual. Do not add a second redirect.

## What changed in code

Generic crawler (`User-agent: *`):

- `Disallow: /*?` — stop fetching query-string views; the artifact sitemap
  remains the inventory for rows past listing page one.
- `Disallow: /*.md$` — stop fetching agent markdown aliases. Retrieval
  user-agents keep `Allow: /` in their own group.

Markdown responses send `X-Robots-Tag: noindex, follow`. Social cards cache
for a day and sit in the Worker Cache API. An uncaught origin failure is 503
with `Retry-After`, not a hard 500.

## Operator follow-up

1. After deploy, Search Console → Pages → "Excluded by `noindex`" → Validate
   fix. The count should move toward "Blocked by robots.txt" as Google recrawls
   `robots.txt`, then drop.
2. URL Inspection on `https://dsh.fish/`, `/browse`, `/docs`, a head plugin
   page, and `/ko/a/dsh-better-edit`. Confirm `robots.txt` is fetched and the
   HTML URL is allowed.
3. Leave `SEO_LOCALE_GATING` off until the Korean CTR test from the first
   export has a second crawl to compare.
4. Do not request indexing of `/browse?q=` or `*.md` URLs.

The backlog that follows from this export is in
[`recommendations.md`](recommendations.md).
