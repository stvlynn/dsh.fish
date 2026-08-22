# SEO and multilingual delivery

This section describes how dsh.fish is made findable — in six languages, for
every page the site owns, including every plugin it indexes.

## Documents

- [`url-strategy.md`](url-strategy.md) — language prefixes, canonical URLs, redirects.
- [`indexation.md`](indexation.md) — what is offered to the index and what is withheld.
- [`structured-data.md`](structured-data.md) — the schema.org graph and where each node comes from.
- [`crawling.md`](crawling.md) — robots.txt, the sitemap set, internal link graph.
- [`recommendations.md`](recommendations.md) — prioritised follow-up work (P0/P1/P2).

Language conventions for writing code — adding a locale, adding a key — are in
[`../frontend/i18n.md`](../frontend/i18n.md).

## Why this matters more here than for most sites

A plugin registry is a search product with no traffic of its own. Nobody has a
bookmark to `dsh.fish/a/acme-release-notes`; they arrive because they searched
for "release notes skill for DeepSeek Harness", possibly in Japanese. Every
indexed artifact is a page whose entire audience arrives through an engine, and
whose only inbound link is the one this site emits in its own sitemap.

That produces three requirements the rest of the product does not have:

1. **Server rendering is not optional.** `ssr: true` in `react-router.config.ts`
   is load-bearing, not a preference.
2. **Every artifact must be discoverable without a link.** Hence the sitemap set
   in [`crawling.md`](crawling.md).
3. **A language must be a URL.** Content negotiation is invisible to a crawler,
   which sends no `Accept-Language`. A reader's explicit choice is remembered
   in a cookie and honoured with a 302 on bare URLs. See
   [`url-strategy.md`](url-strategy.md).

## The shape of it

| Concern | Where it lives |
|---|---|
| Locale registry, catalogs, `translate` | `frontend/src/shared/config/i18n/` |
| URL prefixing, canonical redirects | `frontend/src/shared/config/i18n/path.ts` |
| Head tags: canonical, hreflang, OG, Twitter | `frontend/src/shared/lib/seo/meta.ts` |
| schema.org nodes (site, breadcrumb, collection) | `frontend/src/shared/lib/seo/structured-data.ts` |
| schema.org node for an artifact | `frontend/src/entities/artifact/lib/artifact-ld.ts` |
| robots.txt, sitemaps, llms.txt | `frontend/src/pages/seo/` |
| Sitemap read model | `backend/src/application/use-case/list-sitemap-entries.ts` |
| Social card generator | `frontend/scripts/build-og-image.mjs` |
| Per-artifact social card, README badge | `frontend/src/pages/artifact-og/`, `frontend/src/pages/artifact-badge/` |

Every page's `meta` export calls `pageMeta`, which emits the complete head set
in one call. React Router replaces the whole descriptor array per route rather
than merging it, so a page that hand-writes a `title` silently drops whatever
the root set — building the full set in one function is what prevents a page
shipping a title with no canonical, or a canonical with no alternates.

The Open Graph set includes a localized title, description, locale and image
alternative, plus the image MIME type and exact dimensions. Twitter receives
the equivalent large-card fields. The shared bitmap itself is language-neutral;
the surrounding metadata is the localized information a preview consumer reads.

## Verifying a change

```sh
pnpm run typecheck
pnpm run test          # locale parity, meta builders, sitemap serialisation
pnpm run dev
```

Then, against `http://localhost:5173`:

```sh
curl -s /robots.txt
curl -s /llms.txt
curl -s /docs/llms.txt
curl -s /docs/cli.md | head
curl -s /sitemap.xml
curl -s /sitemaps/artifacts/0.xml | head
curl -sI /sitemaps/artifacts/0   # expect 301 → /sitemaps/artifacts/0.xml
curl -sI /en/browse            # expect 301 → /browse
curl -s /ja/kind/skill | grep -E 'canonical|hreflang|<html'
```
