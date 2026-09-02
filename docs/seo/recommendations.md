# SEO recommendations

What is already implemented is described in the rest of this section. This
document is the backlog: what is worth doing next, and what is deliberately not
worth doing.

Priorities are `P0` (do before the site is announced), `P1` (do once it has
traffic), `P2` (do if the numbers justify it). No dates — order and dependencies
only.

---

## P0 — before announcing the site

### Register the origin with the engines

Nothing below matters until an engine knows the site exists. Submit
`https://dsh.fish/sitemap.xml` to Google Search Console and Bing Webmaster
Tools, and verify the property. Bing's submission also feeds DuckDuckGo. For a
DeepSeek-adjacent audience, submit to Baidu Ziyuan and Yandex Webmaster as well
— the Chinese and Russian catalogs are otherwise unlikely to be discovered at
all.

Then, in Search Console, check the **International Targeting** report. It is the
only place a broken `hreflang` cluster shows up as an error rather than as
silence.

The domain property is verified and the sitemap is submitted. Exports are in
[`search-console.md`](search-console.md). Remaining operator work: URL
Inspection on `/`, `/browse`, `/docs`, and `/ko/a/dsh-better-edit`; the
International Targeting report for `hreflang` errors; after the coverage-fix
deploy, validate the "Excluded by `noindex`" set so those URLs move to
"Blocked by robots.txt" instead of being refetched. HTTP and retired-locale
URLs already 301 — do not add a second redirect, wait for them to leave the
page report.

### Confirm `PUBLIC_BASE_URL` is the production origin

Every canonical URL and every sitemap `<loc>` is built from
`container.config.baseUrl`, which is `PUBLIC_BASE_URL`. A preview deployment
that inherits the production value emits production canonicals from a preview
host; one that is left at `localhost` emits `http://localhost` canonicals to a
crawler. Set it per environment, and keep preview deployments out of the index
(a preview-only `X-Robots-Tag: noindex` response header is the usual mechanism).

### Get real content into the catalog

The single largest ranking factor here is not markup. A plugin page whose only
unique text is a one-line summary has almost nothing to rank on; the same page
with a readme has a few hundred words of it. The crawler already reads readmes —
make sure the ingestion path is actually populating `readmeMarkdown` for the
majority of rows, and treat a low fill rate as an SEO defect, not a cosmetic one.

### Plugin titles say what the plugin does

A result at position two with a kebab-case package name and a kind label
("Bundle", "번들") does not get clicked. Artifact `<title>` is
`{name} — {summary}`, clamped to 60 characters, built by `artifactSearchTitle`.
Kind and the site name stay out of it: Google prints the sitename on its own
line, and the kind is already in the meta description. The first Search
Console export that forced this is in [`search-console.md`](search-console.md).

### Keep sitemap modification times truthful

The crawler records every source check in `indexedAt`, while sitemap `lastmod`
comes from `updatedAt`. Only a change to public artifact content or metadata may
advance `updatedAt`; a no-op sweep must leave it untouched. The domain aggregate
enforces this distinction and its regression tests remain part of the release
gate.

---

## P1 — once there is traffic

### A `SoftwareApplication` rich result

`offers` is deliberately absent (see [`structured-data.md`](structured-data.md)).
One honest route to the rich result remains:

- **`offers` with `price: 0`** once the catalog records a licence classification
  it can stand behind — that is a factual claim about a free, open-source
  artifact, not an invented one.

`aggregateRating` shipped with the reviews feature: artifacts with at least one
real harness-submitted rating emit the node (see
[`structured-data.md`](structured-data.md)). It is still never synthesised from
stars — a GitHub star is not a rating, and asserting that it is invites a
manual action.

### Translate the highest-traffic artifact summaries

The catalog is deliberately not machine-translated. But a _curated_ translation
of the summary for the top ~100 artifacts, stored as a distinct field and
attributed as an editorial translation, would make those pages genuinely
competitive in the non-English clusters instead of ranking on their frame alone.
This needs a schema change (`artifact_translations` keyed by artifact + locale)
and an editorial process. Do not start it without the second half.

### Measure which languages earn their keep

Six languages is still a guess. The first export already shows the failure
mode this item was for: South Korea produced 88 impressions at position 2.1
and zero clicks, almost all of them on the English URL of one plugin. That is
a title/`hreflang` problem, not evidence that Korean should be removed. Leave
`SEO_LOCALE_GATING` off until the Korean cluster is associated; gating now
would `noindex` incomplete translations and leave English as the only URL
Korea can be shown. Revisit after the next crawl whether Korean, Japanese and
Chinese CTR recovered. A language that still has impressions and a poor CTR
after the title change is a copy fix. A language with no impressions after
the catalog has been fully crawled is a candidate to drop.

### Core Web Vitals

The pages are server-rendered and light, but this has not been measured against
field data. Two known candidates once there is a real page to measure:

- The Google Fonts stylesheet in `root.tsx` is a render-blocking request to a
  third-party origin. Self-hosting IBM Plex as a `woff2` subset with
  `font-display: swap` removes a DNS lookup, a TLS handshake and a round trip
  from the critical path.
- The plugin page's rendered readme is unbounded in height. A very long readme
  ships a large DOM on a page whose above-the-fold content is the header and the
  install panel.

Measure first. Neither is worth doing on suspicion.

---

## P2 — if the numbers justify it

### Content that is not a catalog row

A registry ranks for `<plugin name>` queries almost by default and for
`how do I …` queries almost never. Guides — "writing a dsh skill", "bridging
Claude Code hooks into dsh" — are what rank for the second kind, and they are
also what earns inbound links.

The hosting is in place: Fumadocs under `/docs/*`, catalog chrome left
alone — see
[`../decisions/adr-0005-product-docs-with-fumadocs.md`](../decisions/adr-0005-product-docs-with-fumadocs.md).
The baseline learning path is now complete in all six locales: first run,
model and workspace setup, Hub and CLI installation, plugin/tool/configuration
development, every publishing format, submission, scoring, and the REST API.
The three highest-friction flows include short source-backed videos with
localized transcripts. Remaining work is editorial depth: add focused recipes
only when a stable, verified use case justifies another page. A stale guide is
worse than no guide.

### Author pages

`/@:author` listing everything one author maintains. Real search demand
(`<author> dsh plugins`), a natural internal link from every plugin page, and it
reuses the collection page machinery. Worth doing once the catalog has enough
authors with more than one artifact for the pages not to be near-empty.

### Search-result pages for high-intent queries — implemented

`/browse?q=postgres` remains `noindex`. Six curated `/for/<topic>` pages cover
memory, code review, web search, vision/OCR, multi-agent systems and UI themes.
They use a bounded taxonomy rather than turning arbitrary searches into URLs,
and require at least three results before indexing.

### `IndexNow` — done

Implemented. The verification file is served at `/indexnow-<key>.txt` from the
Worker entry (`INDEXNOW_KEY` var), and
`frontend/scripts/indexnow-submit.mjs` pushes the sitemap URL set to Bing,
Yandex, Seznam and Naver as a manual post-deploy step. See
[`crawling.md`](crawling.md#indexnow). Google does not participate, so the
sitemap remains the discovery channel there. Still open: wiring submission into
the ingestion report so an hourly sweep pushes exactly the changed URLs
rather than someone re-submitting the whole set by hand.

---

## Explicitly not recommended

- **A `keywords` meta tag.** No engine has used it in twenty years.
- **Making the filtered `/browse` views indexable.** They are near-duplicates of
  pages that already have canonical homes; indexing them would compete with
  those pages rather than add reach.
- **Prerendering the whole catalog to static files.** The site is already
  server-rendered from D1 in one round trip, and a catalog that re-crawls every
  hour would need a rebuild on the same cadence to stay correct.
