# ADR 0007: Editorial blog as a second Fumadocs collection

## Status

- Accepted

This record extends [`adr-0005-product-docs-with-fumadocs.md`](adr-0005-product-docs-with-fumadocs.md).
The Worker constraints in that decision still apply: build-time MDX, no
`fumadocs-ui`, no `eval`, no runtime filesystem, `/api/*` is Hono, theme is
the existing cookie, palette stays hue 263.

## Context

Product docs at `/docs` are guides: how to publish, how the score is
computed, how the CLI works. They are not dated, they are not a changelog,
and they must not mix hub news with install instructions.

Four editorial series still need a public URL:

1. **Harness releases** — what changed in an official DeepSeek Harness
   version, read from the changelog and the code that landed with it.
2. **DeepSeek notes** — official DeepSeek announcements, followed through
   to what they change for the harness and this catalog.
3. **dsh.fish changelog** — what shipped on this hub.
4. **Technical notes** — original writing on how the harness is put
   together and how the hub maps onto it.

Fumadocs' own blog is a `defineCollections` source with `author` and
`date` on `pageSchema`, a custom listing UI (not `DocsLayout`), and a
flat `/blog/:slug`. This site already has six locale prefixes, sitemap
enumeration from the MDX tree, markdown negotiation, and `pageMeta`. The
question is whether a second Fumadocs collection fits those contracts
without becoming a second theme or a second origin.

## Decision

1. **Add `/blog` as a Fumadocs collection**, not as i18n-key paragraphs
   and not as another docs sidebar. Schema is the official blog shape
   (`author`, `date`) plus a closed `series` enum:
   `harness | deepseek | changelog | notes`.
2. **Nest URLs as `/blog/{series}/{slug}`.** Series landings and the
   index are React listings generated from the same collection. A flat
   `/blog/:slug` would collide series names with post slugs and hide the
   four tracks from crawlers.
3. **Keep the ADR 0005 constraints.** MDX compiles at build time.
   `fumadocs-ui` stays out. Chrome is `widgets/blog-shell` (series nav +
   post TOC). Fumadocs i18n uses the same `LOCALE_CODES` and dot-suffix
   files as docs (`v0-1-2-alpha-1.mdx`, `v0-1-2-alpha-1.zh-CN.mdx`).
   English fallback keeps the route up; a fallback-only locale is not
   canonical and is not advertised in `hreflang` or the sitemap.
4. **Do not put the blog under `/docs`.** A changelog is not a publishing
   guide. Mixing them would poison both rankings.
5. **Long-form prose lives in MDX.** Button labels and series names stay
   in `messages/*.json`. Code identifiers stay English in every locale.

## Hard constraints (inherited, restated)

- Search for the blog is not required at launch. If it appears later, it
  must not be `/api/search`.
- Never `getText('raw')`. Markdown negotiation uses `import.meta.glob`
  in `pages/blog/raw.ts`, the same Worker-safe pattern as docs.
- `pages/seo` and `pages/markdown` may import blog helpers so
  `pages.xml`, `Accept: text/markdown`, `/blog/llms.txt`, and
  `/blog/feed.xml` are generated from the collection, not a second list.
- Posts emit `BlogPosting` JSON-LD with facts the page has: headline,
  description, `datePublished`, author name. No invented `wordCount`.
- Blog pages advertise `/blog/feed.xml` (Atom), not the catalog
  `/feed.xml`.

## FSD placement

```
frontend/content/blog/          MDX source (outside the FSD tree)
frontend/src/pages/blog/        routes, loader, collection source, raw markdown
frontend/src/widgets/blog-shell/     series nav + listing + TOC
```

`source.ts` stays in the page slice. Nothing outside that slice imports
Fumadocs except the documented sitemap / llms.txt exception.

## Indexation

`/blog`, `/blog/{series}`, and each post are indexable when a physical
locale file exists. `/blog/feed.xml` and `/blog/llms.txt` are not in the
HTML sitemap. `/sitemaps/pages.xml` enumerates the collection.

## Alternatives considered

### Fold the blog into `/docs`

Rejected. Docs are a learning path. A dated changelog and a release
reading of Harness are a different intent and a different crawl.

### A third-party blog host or a second origin

Rejected. Same reason ADR 0005 rejected `docs.dsh.fish`: cookies, CORS,
and ranking stay on one Worker.

### i18n catalogs instead of MDX

Rejected. A technical post is thousands of words with tables and
citations. Putting that in `messages/*.json` is the failure mode ADR 0005
already named.

### Flat `/blog/:slug` as in the Fumadocs example

Rejected for this catalog. Four series are the product, not an optional
tag. Nested paths give each series a landing a crawler can rank.

## Consequences

Easier:

- Authoring a post is adding MDX under `content/blog/{series}/`.
- Sitemap, markdown, Atom, and `/blog/llms.txt` stay generated.
- `/ja/blog/harness/v0-1-2-alpha-1` is a real, indexable URL.

Harder:

- A second MDX tree to keep in locale parity with docs.
- Worker bundle size now includes two Fumadocs collections.

## What shipped

| Piece             | Where                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| MDX (six locales) | `frontend/content/blog/{harness,deepseek,changelog,notes}/`                                                    |
| Collection        | `frontend/source.config.ts` — `defineCollections`, series enum                                                 |
| Source loader     | `frontend/src/pages/blog/source.ts` — `toFumadocsSource(blog, [])`                                             |
| Routes            | `:locale?/blog`, `:locale?/blog/*`, `:locale?/blog/feed.xml`, `blog/llms.txt`                                  |
| Shell             | `widgets/blog-shell` — series pills + post TOC                                                                 |
| Covers            | `frontend/public/blog/covers/` — one 16:9 landscape editorial poster per post, referenced by required `cover` frontmatter |
| Markdown          | `pages/blog/raw.ts` glob; listings generated from frontmatter                                                  |
| Atom              | `/blog/feed.xml` and `/<locale>/blog/feed.xml`                                                                 |

Every shipped post has a physical file for all six locales. English
fallback remains a route-safety mechanism.

## References

- [Fumadocs: make a blog](https://www.fumadocs.dev/docs/blog)
- [`adr-0005-product-docs-with-fumadocs.md`](adr-0005-product-docs-with-fumadocs.md)
- [`../frontend/i18n.md`](../frontend/i18n.md)
- [`../seo/indexation.md`](../seo/indexation.md)
