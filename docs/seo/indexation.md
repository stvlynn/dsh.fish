# What is indexed

Being in the index is not free: a crawler has a budget for this origin, and
every near-duplicate URL it spends that budget on is a plugin page it did not
fetch. The rule is that a URL is offered to the index only when it is the
canonical home of something.

## The table

| URL                                 | Indexed              | Why                                                                                                                                                                             |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` and `/:locale`                  | ✅                   | The landing page, per language.                                                                                                                                                 |
| `/a/:artifactId`                    | ✅                   | The reason the site exists. One per indexed plugin, per language.                                                                                                               |
| `/kind/:kind`                       | ✅ (page 1)          | "MCP servers for DeepSeek Harness" is a phrase people type.                                                                                                                     |
| `/category/:category`               | ✅ (page 1)          | The "what is it for" axis people search along.                                                                                                                                  |
| `/for/:topic`                       | ✅ (page 1, ≥3 rows) | Curated workflow pages; thin and paginated variants remain `noindex, follow`.                                                                                                   |
| `/browse` (bare)                    | ✅                   | The catalog itself.                                                                                                                                                             |
| `/browse?…` any query               | ❌ `noindex, follow` | A view of a listing that already has a canonical home.                                                                                                                          |
| `/kind/…?offset=`                   | ❌ `noindex, follow` | Page two is a real page but not the page to land on for the term.                                                                                                               |
| `/docs`                             | ✅                   | "How do I publish a dsh plugin" is a question people search.                                                                                                                    |
| `/docs/…` (MDX pages)               | ✅                   | One URL per physical locale guide (`/docs/cli`, `/docs/publish/hook-bridge`, …). Generated from the Fumadocs source into `pages.xml`; fallback-only locales are not advertised. |
| `/docs/search`                      | ❌                   | JSON title/description index for the section. Not a document.                                                                                                                   |
| `/submit`                           | ✅                   | Same — the explanation is public even though the form is gated.                                                                                                                 |
| `/dashboard`, `/sign-in`, `/device` | ❌ `noindex, follow` | Account pages. Nothing a search result should lead to.                                                                                                                          |
| 404s                                | ❌                   | A real 404 status, never a soft one.                                                                                                                                            |

`follow` is kept on everything excluded. A signed-in-only page is not worth
indexing, but the links out of it lead to pages that are.

## Faceted navigation

The catalog can mint effectively unlimited URLs: any combination of `kind`,
`category`, `sort`, `verified`, `q` and `offset` is a distinct query string
over the same rows. This is the classic way a directory burns its crawl budget.

Three mechanisms in HTML, plus one in robots.txt:

1. **Any query at all makes `/browse` `noindex`.** The loader reports
   `filtered: [...url.searchParams.keys()].length > 0`.
2. **Filter links carry `rel="nofollow"`.** The canonical home of a single-facet
   listing is `/kind/<kind>` or `/category/<category>`, which the footer links
   and the sitemap carries. A combination filter is a view of it.
3. **The single-facet listings get real paths**, so the terms worth ranking for
   have a stable, linkable, canonical document instead of a query string.
4. **`robots.txt` `Disallow: /*?` for `User-agent: *`.** `nofollow` is a hint;
   Google still fetched ~100k `noindex` query URLs in the first coverage
   export. Blocking the fetch keeps that budget for sitemap URLs. Retrieval
   agents keep `Allow: /` in their own group.

Keyword links on a plugin page point at `/browse?q=<keyword>` and are
`nofollow` for the same reason. Pagination stays `noindex, follow` in HTML so
a client that ignores robots.txt can still walk it; the artifact sitemap is
how Google is supposed to find those rows.

## Locale quality gate

Artifact translations are indexable when generated summary (and README, when
the artifact has one) prose is still on the row — the current completed
translation, or the previous completed body retained while a replacement is
queued. `availableLocales` exposes that decision to
the page head and sitemap. `SEO_LOCALE_GATING=false` preserves the previous
all-locale behavior during backfill; enable it only after checking coverage.

## Pagination

`CatalogPagination` renders real anchors with real `href`s — a listing whose
later pages are reachable only by JavaScript hides everything past its first
two dozen rows, which in a catalog is most of the catalog.

Page one is the bare path: the widget deletes `offset` rather than writing
`?offset=0`, so the first page has exactly one URL. Later pages are `noindex,
follow`, which keeps them crawlable as a path to the plugin pages on them while
keeping the term's landing page unambiguous.

## Deprecated artifacts

A deprecated artifact still resolves, still renders, and is still linked from
pages that reference it — but it is excluded from the sitemap. It is not
something to actively invite a crawler to.

## Third-party readme text

A plugin page's readme is rendered as structured markdown, not as raw HTML.
`frontend/src/shared/ui/markdown.tsx` builds React elements from an AST,
`skipHtml` drops raw HTML, and every URL goes through a protocol allowlist —
there is no `dangerouslySetInnerHTML`. The prose is still the unique indexable
content a plugin page has; headings become real heading elements, which is
better for the crawler than a `<pre>` of the source.

## Artifact ask

Q&A on a plugin page is client-only. Crawlers still see the artifact document
(readme, install plan, reviews) without chat transcripts: nothing from Ada is
in the HTML the loader returns, and `POST /api/v1/artifacts/:id/ask` is not a
snapshot or sitemap URL.
