# Crawling: robots, sitemaps, internal links

## robots.txt

Served from `frontend/src/pages/seo/robots.ts` at `/robots.txt`. It disallows
`/api/` and names the sitemap index.

Account pages remain crawlable even though they are `noindex, follow`. A search
engine must fetch a page to read that directive; blocking `/dashboard`,
`/device`, or `/sign-in` in robots.txt can leave the URL indexed without a
snippet because the crawler knows the URL exists but cannot see its `noindex`.
The API is different: it is machine-only JSON with no HTML directive to read,
so blocking it saves crawl budget without hiding an indexation instruction.

Nothing there is a security boundary. robots.txt is a request, and the paths it
names are exactly the paths anyone can read in it.

Search/retrieval agents (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`,
`Claude-User`) may crawl public pages and the catalog snapshot; training
crawlers (`GPTBot`, `ClaudeBot`) are denied. Public responses also send
`Content-Signal: ai-train=no, search=yes, ai-input=yes, use=reference`.

## The sitemap set

```
/sitemap.xml                       sitemapindex
├── /sitemaps/pages.xml            home, browse, 6 kinds, 12 categories, every /docs slug, submit
└── /sitemaps/artifacts/:n.xml     one page of the catalog, 1,000 artifacts each
```

An index rather than one flat file. Every non-deprecated artifact in the catalog
is included, not only the popular or recently updated rows, and every URL is
emitted once **per language**. Child files end in `.xml`, matching `pages.xml`
and the filename convention the protocol examples and Search Console expect.
`/sitemaps/artifacts/0` (no extension) 301s onto `/sitemaps/artifacts/0.xml`.

sitemaps.org and Google cap a file at 50,000 URLs or 50 MB uncompressed. At
six locales, production XML is about 5.3 KB per artifact after its alternate
links are expanded; 1,000 rows is ~5 MB / 6,000 URLs. That stays inside the
cap with room for longer ids and future locales, and is small enough that
Search Console's fetcher can finish the document — a 2,500-row / 13 MB file
at the extensionless URL was reported unreadable. A Worker also has to hold
the whole document in memory to send it. The index costs one extra fetch and
never has to be restructured later.

Static pages get their own file so a crawler re-reading the catalog does not
re-read them, and vice versa.

### Alternates in the sitemap

Each `<url>` entry carries the full `xhtml:link` alternate set — the sitemap
form of `hreflang`. Both forms are emitted, here and in the page head, because
they are read at different times: the head only after a page is fetched, the
sitemap before anything is.

For a path translated into all six languages that is 6 entries × 7 links.
Product-doc entries derive their locale set from physical MDX files, so an
English fallback never creates a false alternate. Adding a page or translation
grows the sitemap in the same commit; do not hand-maintain a second list.

Artifact entries follow the same rule after `SEO_LOCALE_GATING` is enabled: a
locale is present only when its summary and optional README translations match
the current source hashes. `x-default` exists only when English is in the
alternate set, and translated variants carry their own translation timestamp
as `lastmod`.

### `lastmod`

Artifact entries carry the artifact's own `updatedAt`, so a crawler re-reads
exactly the rows whose public page changed. A routine source check advances
`indexedAt` but leaves `updatedAt` alone; otherwise every hourly sweep would
falsely mark the whole catalog as modified and make `lastmod` meaningless.

The value is W3C Datetime as sitemaps.org requires it: `YYYY-MM-DD` or a
full timestamp with a timezone. Fractional seconds from `Date#toISOString()`
(`…32.946Z`) are stripped on emission — Google's examples never include them,
and Search Console has treated that form as an unreadable sitemap.

Google ignores `changefreq` and `priority`. Artifact sitemaps omit both so
the document stays smaller; `pages.xml` still carries them as relative hints
inside that file.

### The read model

`ListSitemapEntries` (`backend/src/application/use-case/`) is separate from
`SearchArtifacts` on purpose. Search is bounded to a page a human would read and
rehydrates whole entities to render cards; a sitemap wants every row and two
fields from each. Running one through the other would either cap the sitemap at
a browse page's worth of URLs or make every browse page pay for a projection it
does not use.

It reads through `ArtifactRepository.listForSitemap`, a port method returning a
`SitemapEntry` projection (`id` + `updatedAt`) rather than an `Artifact`. Locale
availability for the 1,000-row page is passed to SQLite's `json_each` as one
JSON binding; expanding the IDs into an `IN` parameter per artifact would
exceed D1's 100-bound-parameter limit.

### Escaping

`escapeXml` handles the five characters XML cannot carry literally. Artifact ids
derive from third-party package names, and an unescaped `&` in one of them does
not produce a slightly wrong sitemap — it produces a document the crawler
rejects whole, taking the other 4,999 URLs in the file with it. There is a test
for exactly this.

### Caching

XML responses are `public, max-age=3600`. The catalog re-crawls every hour,
so an hour-old sitemap is never more than one sweep behind, and a crawler
pulling every file in the index does not cost one D1 read per file per fetch.

## Feeds

`/feed.xml` is an Atom 1.0 feed of the 50 most recently updated non-deprecated
artifacts, and each of the other nine languages has its own at
`/<locale>/feed.xml` — the same URL-prefix rule as every reader-facing page.
The route is `frontend/src/pages/seo/feed.ts`; serialization lives in
`atom.ts` next to it and reuses the sitemap's `escapeXml`, because entry titles
and summaries come from third-party package manifests too.

The sitemap and the feed answer different questions. The sitemap is the
complete, crawled-on-the-engine's-schedule inventory; the feed is the "what
changed" channel a reader's aggregator or a feed-aware crawler polls. A feed
is deliberately a window, not an export — the sitemap set is the complete one.

Two details keep the ten feeds coherent. Every entry's `<id>` is the canonical
_English_ artifact URL, so the same artifact is the same entry in all ten
feeds and a subscriber switching languages does not see the whole catalog as
new. And each indexable page advertises its own language's feed with a
`<link rel="alternate" type="application/atom+xml">` in the head, emitted by
`pageMeta` next to the hreflang set.

Feeds carry the same cache contract as the sitemap (`public, max-age=3600`).

## IndexNow

Bing, Yandex, Seznam and Naver accept a push notification when a URL changes;
Google does not participate. The verification file is served at
`/indexnow-<key>.txt`, returning the key itself.

The route lives in the Worker entry (`frontend/workers/app.ts`), not in the
React Router table: the filename _is_ the key, and route parameters only match
whole path segments, so no route pattern can express `indexnow-<key>.txt` with
a runtime key. The key is a plain var (`INDEXNOW_KEY` in
`frontend/wrangler.jsonc`) — public by design, since serving it is the entire
point. When the var is unset, the file 404s and submissions simply cannot be
verified.

Submission is a manual post-deploy step, not part of the cron sweep:

```sh
INDEXNOW_KEY=<key> pnpm --filter @dsh-fish/frontend run indexnow:submit
```

`frontend/scripts/indexnow-submit.mjs` reads the sitemap index, fetches every
child sitemap, and submits the full URL set to `https://api.indexnow.org` in
batches of 10,000 (the protocol cap). URLs come from the sitemap rather than
the database so the submitted set is by definition the set we want indexed.

## llms.txt

[llmstxt.org v2](https://llmstxt.org/) is a curated markdown overview for
inference-time agents, not a sitemap and not a training opt-out. Chrome
Lighthouse's agentic-browsing audit fetches `GET /llms.txt`; coding agents
then follow the links.

```
/llms.txt                 origin coverage — kinds, API, pointer at the docs index
/docs/llms.txt            product-docs coverage, generated from the Fumadocs nav
/docs/llms-full.txt       every English guide concatenated (community convention)
```

The root file is English and deliberately small. It does not enumerate
plugins: that is the JSON API and the catalog snapshot. Kind landings are
generated from `ARTIFACT_KINDS` the same way the sitemap is, so a kind added
to the domain appears in `/llms.txt` in the same commit. `/docs/llms.txt`
is generated from `docsNav('en')` and the loader throws if a sitemap slug is
missing. `/docs/llms-full.txt` concatenates `productDocsPaths()` through
`productDocsMarkdown`; the plugin catalog is not dumped.

There is no `/:locale/llms.txt` and no `/.well-known/llms.txt`. Agents fetch
the conventional filename at the origin; other languages are a path prefix
on the pages the file points at.

Routes live in `frontend/src/pages/seo/` next to robots and the api-catalog.
Responses are `text/markdown; charset=utf-8` with `public, max-age=86400`.

## Markdown for agents

Agents can ask for any content page as markdown instead of HTML, either by
content type or by the v2 `.md` alias:

```sh
curl https://dsh.fish/a/<artifact-id> -H "Accept: text/markdown"
curl https://dsh.fish/a/<artifact-id>.md
curl https://dsh.fish/docs/cli.md
curl https://dsh.fish/index.md
```

Directory URLs use `index.md` (`/` → `/index.md`, `/docs` → `/docs/index.md`)
so the docs tree stays under `/docs/` and `/docs/llms.txt` covers it. Artifact
ids are kebab-case with no dots, so `/a/foo.md` cannot collide with an id.

The negotiation lives in the Worker entry (`frontend/workers/app.ts` →
`frontend/src/pages/markdown/`). When `Accept` prefers `text/markdown`
(q-values honoured, wildcard ignored), or the path is a `.md` alias, the
handler answers from the same use cases the SSR loaders use; anything else —
browsers on HTML URLs, UI pages like `/submit`, unknown paths — falls through
to React Router unchanged. Responses carry `Content-Type: text/markdown`,
an `x-markdown-tokens` estimate, and a `content-signal` header. HTML URLs
that also negotiate markdown send `Vary: Accept`.

Covered paths: `/`, `/browse` (filters included), `/kind/<kind>`,
`/category/<category>`, `/a/<id>`, and `/docs/*`, in every locale. The plugin
page variant is the strongest one: frontmatter from the page meta, the metadata
row, the install commands, the artifact's own readme verbatim (already markdown
in the catalog — no HTML scrape involved), and the page's JSON-LD as a fenced
block, matching the layout agents are taught to expect.

## Link headers for agent discovery

Every 200 HTML or markdown response carries `Link` headers (RFC 8288) naming the
machine-readable doors into the catalog, so an agent learns them without
parsing any markup:

```
Link: </.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"
Link: </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"
Link: </docs>; rel="service-doc"; type="text/html"
Link: </api/v1/catalog/snapshot>; rel="describedby"; type="application/json"
Link: </llms.txt>; rel="describedby"; type="text/markdown"
```

Pages under `/docs` point `describedby` at `/docs/llms.txt` instead of the
origin file (v2: the most specific covering file wins). Indexable HTML pages
repeat both relations in `<head>` via `pageMeta`.

Pages that have a markdown representation add an `alternate` link pointing at
the `.md` alias: `<https://dsh.fish/ja/browse.md>; rel="alternate"; type="text/markdown"`.
`Accept: text/markdown` still works on the HTML URL; the alias is what an
agent following llms.txt actually GET. The Worker entry decides this through
`supportsMarkdownNegotiation` (`frontend/src/pages/markdown/handler.ts`),
which mirrors the markdown route table; error pages and UI-only pages
(`/submit`, `/dashboard`, …) carry no markdown alternate, and the decorator
itself (`frontend/src/shared/api/agent-discovery.ts`) skips non-document and
non-200 responses.

The documents those headers point at are resource routes under
`frontend/src/pages/seo/`:

- `/.well-known/api-catalog` — the RFC 9727 api-catalog linkset
  (`application/linkset+json`). It anchors the JSON API at `/api/v1` with its
  `service-desc` (the OpenAPI document), `service-doc` (`/docs`) and `status`
  (`/api/health`), and anchors the origin with `describedby` pointing at the
  whole-catalog snapshot and `/llms.txt`.
- `/openapi.json` — an OpenAPI 3.1 description of the anonymous read surface:
  search, artifact detail, install-plan resolution, facets, the scoring model
  and the versioned snapshot with its ETag/304 contract. Submissions, admin
  and auth routes are deliberately absent — they are not part of the
  machine-consumable contract. The document is hand-maintained
  (`openApiDocument`), and its test asserts the path list stays exactly the
  eight public endpoints, so adding an endpoint without documenting it fails
  CI.

## Internal link graph

A page nothing links to is a page nothing ranks. Three deliberate link sources:

1. **The footer** links every artifact type, category and curated intent topic to its own
   indexable path, generated from the domain taxonomy rather than hand-listed —
   so a kind added to the domain appears in the footer and the sitemap in the
   same commit. Eighteen links in a footer is unremarkable for a directory, and
   it makes every landing page one hop from every other page.
2. **The home page's type chips** point at `/kind/<kind>`, not at `?kind=`.
3. **Each plugin page** carries a visible breadcrumb up to its type's collection
   page, and links its categories to theirs.

Language variants are not in the internal link graph. A crawler that reached one
language finds the other nine through the `hreflang` set in the page head and
the sitemap `xhtml:link` alternates. The header language switcher is a reader
control; its panel is portal-rendered and is not in the server's HTML.

## Social card

Static pages point `og:image` at `/og.png`, generated by
`frontend/scripts/build-og-image.mjs` and committed:

```sh
pnpm --filter @dsh-fish/frontend run og:build
```

The site card deliberately contains no translatable sentence. All ten language
variants share the same image while their `og:title`, `og:description`,
`og:locale`, and image alt text stay localized in the page head; an English-only
claim baked into the bitmap would contradict nine of those previews.

Generated rather than drawn, and committed rather than rendered per request: a
Worker would need a font rasteriser and a few hundred milliseconds to produce it
at request time, and the card does not vary. Re-run it when the palette or the
wordmark changes. In a sandbox that ships its own Chromium, set
`CHROMIUM_EXECUTABLE_PATH` rather than letting Playwright download a second copy.

Artifact pages instead point `og:image` at `/a/:artifactId/og.png`, a resource
route that renders the card on request with satori (JSX → SVG) and
`@resvg/resvg-wasm` (SVG → PNG) inside the Worker
(`frontend/src/pages/artifact-og/`, renderer in `frontend/src/shared/lib/og/`).
The card carries the artifact's name, kind, grade, counts and summary over the
same dark ground as the site card, in English only — one bitmap per artifact
serves every language variant, same as the site card. It has to be a PNG:
Slack, X and the other link-preview fetchers do not rasterise SVG `og:image`s,
so an SVG route would preview as nothing. The Wasm cost (~1 MB of bundle,
~150–300 ms cold) lands only on link-preview fetches, never on the HTML path;
responses carry the same `public, max-age=3600` contract as the sitemap XML.

A sibling route, `/a/:artifactId/badge.svg`, serves the shields-style README
badge (`dsh.fish | A · 78`, or the star count with `?metric=stars`). The
artifact page hands authors the Markdown snippet; the badge lives outside
`/api/` because that namespace is the versioned JSON contract, and robots.txt
keeps crawlers out of it.
