# ADR 0005: Product documentation as a Fumadocs section

## Status

- Accepted

This record is the evaluation of whether dsh.fish can grow its reader-facing
documentation, and whether [Fumadocs](https://github.com/fuma-nama/fumadocs)
is the right way to host it. The constraints below still apply to every later
change.

## Context

The repository already has two documentation surfaces that look alike and are
not the same thing:

| Surface                 | Audience                                              | Form today                            | Purpose                               |
| ----------------------- | ----------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| `docs/` in this repo    | coding agents and maintainers                         | Markdown, linked from `AGENTS.md`     | FSD/DDD conventions, operations, ADRs |
| `https://dsh.fish/docs` | plugin authors, CLI users, agents discovering the hub | one React page, copy in i18n catalogs | how to publish, how the score works   |

The first surface is already detailed enough for agents: a change that alters
behavior is supposed to update the matching file in the same commit. Turning
`docs/` into a website would hide it from the agents that read the repo.

The second surface is not. `/docs` is a single route
(`frontend/src/pages/docs/docs-page.tsx`) with five kind tabs and a scoring
section. The scoring tables are the right shape — they render
`DescribeScoring` so the documented formula cannot drift from
`GET /api/v1/scoring` — but the rest of the page is one paragraph and one
snippet per kind. `hook-bridge` has no tab at all. There is no CLI reference,
no hub-plugin tool list, no submit/claim walkthrough, no human-readable API
guide, and no "how to write a skill" page.

That gap is already named. [`../seo/recommendations.md`](../seo/recommendations.md)
lists "content that is not a catalog row" as P2: a registry ranks for plugin
names by default and for `how do I …` queries almost never. Guides are what
rank for the second kind. The same document warns that a stale guide is worse
than no guide — this is a content commitment, not a component swap.

Fumadocs is a React docs framework (MDX, sidebar, TOC, search) with official
React Router, Tailwind CSS 4, and i18n support. The question is whether it
fits a site that is already a React Router 8 SSR app on one Cloudflare Worker,
with six locale prefixes, a cookie-backed theme, a custom palette, and Hono
owning `/api/*`.

## Decision

1. **Grow the reader-facing docs.** `/docs` should become a section, not stay
   a page. The first content to add is the missing product surface, not more
   FSD/DDD prose.
2. **Keep `docs/` as agent Markdown.** Do not publish the convention tree
   through Fumadocs. Agents read files; a docs UI does not help them.
3. **Adopt Fumadocs for the product section only**, behind `/docs/*`. Use
   `fumadocs-core` plus `fumadocs-mdx`, with MDX compiled at **build time**.
   Do not wrap the catalog, auth pages, or the site chrome in `DocsLayout`.
   Do not take `fumadocs-ui`: a second theme store and `neutral.css` would
   fight the cookie-backed `.light` / `.dark` class and the hue-263 palette.
   Sidebar, TOC, and MDX tags are first-party widgets that consume the
   Fumadocs page tree.
4. **Do not start from the stock Fumadocs app layout.** The integration has
   hard constraints (below). Treat Fumadocs as a docs engine inside the
   existing Worker, not as a second origin or a second framework.

The first content to ship is the missing product surface (hook bridges, CLI,
hub plugin, per-kind publishing, submit/claim, scoring), not more FSD/DDD
prose. A shell around five tabs with no new documents would have been the
stale-guide failure mode the SEO backlog already rejects.

## What the product docs should cover

Order is importance, not calendar. Each item is a page (or a small cluster)
with a stable URL a crawler can rank:

| Priority | Page                      | Why it is missing today                                                        |
| -------- | ------------------------- | ------------------------------------------------------------------------------ |
| P0       | Hook bridges              | Sixth kind, no tab, people will search for "Claude Code hooks dsh".            |
| P0       | CLI (`npx @dsh-fish/cli`) | The install plan's first command; README covers a subset.                      |
| P0       | Hub plugin tools          | `hub_search` / `hub_install` / `hub_rate` / device login.                      |
| P1       | Publishing each kind      | Expand the five paragraphs into real manifests, probes, and rejection reasons. |
| P1       | Submit, claim, verify     | The form is public; the ownership rule lives only in ADRs.                     |
| P1       | Scoring                   | Keep the live `DescribeScoring` render; move it to its own URL.                |
| P2       | REST API                  | OpenAPI already exists; humans still need a walkthrough.                       |
| P2       | Guides                    | "Write a skill", "declare an MCP server", "bridge Codex hooks".                |

Code identifiers in snippets stay English in every locale
([`../frontend/i18n.md`](../frontend/i18n.md)). Chrome (nav, titles,
descriptions) stays in the existing message catalogs **or** in per-locale MDX
frontmatter — not both for the same string.

## Why Fumadocs fits the stack

| This project                                                            | Fumadocs                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| React 19, React Router 8, Vite, Tailwind CSS 4                          | Official React Router guide; Tailwind 4 CSS imports                                                            |
| Optional locale prefix, default language bare                           | `defineI18n({ hideLocale: 'default-locale' })` and `:lang?/docs/*`                                             |
| SSR on Cloudflare Workers, `nodejs_compat`                              | `@fumadocs/local-md` documents a no-`eval` Markdown path for Workers; build-time MDX avoids the issue entirely |
| Existing `/docs` in the header, footer, sitemap, and `service-doc` Link | Nested routes under the same path keep those contracts                                                         |

Headless `fumadocs-core` (page tree, source loader) is the load-bearing part.
`fumadocs-ui` is optional chrome and was not taken: remapping it onto hue 263
and a cookie theme is more work than a small in-column shell, and a second
visual system next to beui is the failure mode this site already rejected.

## Hard constraints

These are the reasons a naive `create-fumadocs-app` paste would break the
site. An implementation that ignores any of them is not this decision.

### `/api/*` is Hono

`frontend/workers/app.ts` sends every `/api/` request to the backend app
before React Router runs. Fumadocs' default search route is `/api/search`.
That URL will never reach a React Router loader.

Search belongs at a docs-owned path such as `/docs/search`. `/api/v1/…`
stays the catalog API.

### No `eval`, no filesystem at runtime

Workers cannot `new Function()` compiled MDX, and they cannot `fs.readFile`
a `content/docs` directory in production.

Compile MDX at build time with the Vite Fumadocs MDX plugin so each page is
a bundled React component. `@fumadocs/local-md` is the fallback if a page
must stay as source Markdown: use `staticSource()` so the snapshot is taken
while Node still exists, and rely on its virtual JS engine rather than
`eval`. Do not use remote MDX compilation, and do not pull
`fumadocs-mdx-cloudflare` / WorkerLoader for first-party docs.

Shiki is large. Highlight at build time (rehype) so the Worker does not
ship a highlighter. Measure compressed Worker size after adding the docs
bundle; paid Workers cap at 10 MB compressed.

### Theme is a cookie, not `next-themes`

The root loader writes `.light` / `.dark` on `<html>` from a `theme` cookie
so SSR and hydration agree. Fumadocs `RootProvider` defaults to a client
theme store. Wrapping the whole app in it would recreate the hydration
mismatch [architecture.md](../project/architecture.md) already forbids.

Scope Fumadocs providers to the docs route. Point them at the existing
theme class on `<html>`. Do not add a second theme cookie.

### Palette and chrome stay ours

`fumadocs-ui/css/neutral.css` is a second design system. Importing it next
to `app.css` would reintroduce a stock palette this site deliberately
abandoned (hue 263 accent, cool neutrals, kinds distinguished by glyph not
colour).

Remap Fumadocs CSS variables onto `--bg`, `--fg`, `--primary`, `--border`.
Keep `SiteHeader` / `SiteFooter` / `LocaleSwitcher`. `DocsLayout` may own
the **sidebar inside the main column**; it must not replace the site nav.

### i18n is already a product feature

Six locales, default language unprefixed, retired prefixes 301, preference
cookie 302, `requireLocale` on every loader, `pageMeta` emitting canonical +
hreflang. Fumadocs i18n must **call into** `shared/config/i18n`, not
duplicate `LOCALES`.

Long-form MDX is an exception to "every string lives in `messages/*.json`":
a guide is a document, not a button label. The exception is bounded:

- UI chrome (sidebar section titles that are not the page title, search
  placeholder, "On this page") stays in the JSON catalogs.
- Each locale gets its own MDX tree (`index.mdx`, `index.zh-CN.mdx`, …) or
  a `dir` parser. Missing translations fall back to English; they must not
  404 a language the rest of the site serves. A fallback-only locale is not
  canonical or advertised through `hreflang` and the sitemap.
- `pageMeta` still builds the head. A Fumadocs `<title>` inside the page
  body is not a substitute.

### Live data is not MDX

The scoring section must keep reading `DescribeScoring`. MDX may mount a
React component that receives loader data; it may not paste the weights as
literals. The same rule applies to any page that documents an API enum the
domain already owns.

### FSD placement

A page orchestrates; it does not become a second app.

```
frontend/content/docs/          MDX source (outside the FSD tree, like public/)
frontend/src/pages/docs/        route, loader, meta, Fumadocs source module
frontend/src/widgets/docs-shell/     sidebar + TOC; lives beside SiteHeader
frontend/src/widgets/docs-scoring/   live DescribeScoring tables
frontend/src/widgets/docs-media/     controlled video + localized transcript
```

`source.ts` lives next to the docs page, not in `shared/`. Nothing outside
the docs slice imports Fumadocs. `pages/seo` and `pages/markdown` may import
docs helpers so the sitemap, `Accept: text/markdown`, and `/docs/llms.txt`
stay generated from the same tree — see [`../frontend/import-rules.md`](../frontend/import-rules.md).

### Indexation

`/sitemaps/pages.xml` lists every indexable slug, per locale, with the same
`xhtml:link` alternate set as every other page. Generate that list from the
Fumadocs source, not a second hand-written array.

`/docs` is the intro page (Fumadocs `index.mdx`). There is no nested home
and no trailing-slash twin. Nested guides are new documents; they get their
own canonical, hreflang, and breadcrumb JSON-LD. `/docs/search` is JSON and
is not in the sitemap.

Cloudflare's React Router guide does not support prerendering. Docs pages
SSR like the rest of the site. That is fine: they are static content with
no D1 read except the scoring island.

### Search vs catalog search

The header palette queries `GET /api/v1/artifacts`. Docs search is a
different index. Do not merge them. A docs search dialog belongs on docs
pages; the catalog palette stays the catalog palette.

## Alternatives considered

### Keep growing the single React page

Rejected as the long-term shape. Tabs do not give a crawler one URL per
question, and they do not give a reader a table of contents once the page
outgrows five kinds. Fine as a stopgap; not fine once CLI, hooks, and
guides exist.

### Nested React Router routes without Fumadocs

Viable for a small section (`/docs`, `/docs/cli`, `/docs/hooks`) using the
existing markdown component and i18n catalogs. Cheaper, fully FSD-native,
no Worker-bundle surprise. Choose this instead of Fumadocs **if** the
section stays under roughly a dozen pages and needs no full-text search.
The moment it needs a generated sidebar, per-page TOC, and MDX components,
Fumadocs is less code than a hand-rolled equivalent.

### A separate Fumadocs origin (`docs.dsh.fish`)

Rejected. A second origin splits cookies, CORS, and ranking. The hub is
one Worker on purpose. Docs are part of the same product a publisher
already has open.

### Publish `docs/` (agent tree) through Fumadocs

Rejected. That tree is the agents' operating manual. HTML navigation, a
search dialog, and MDX imports make it worse for the readers who actually
use it. If a human maintainer wants it rendered, GitHub already does that.

### Next.js + Fumadocs + OpenNext on Cloudflare

Rejected. The site is React Router because the catalog SSR and the API
share one Worker. Moving docs to Next.js is a second framework, a second
deploy, and Fumadocs on Next.js Edge is explicitly unsupported.

## Consequences

Easier:

- Authoring a guide is adding an MDX file, not another i18n-key forest of
  paragraphs.
- Sidebar, TOC, and docs search come with the framework instead of being
  invented against FSD.
- `/docs/cli`, `/docs/publish/hook-bridge`, `/ja/docs/cli` become real, indexable URLs.

Harder:

- A second content pipeline (MDX + catalogs) to keep in locale parity.
- Theme and CSS token mapping must be tested in light, dark, and
  `prefers-color-scheme`.
- Worker bundle size becomes a release-gate concern the first time Shiki
  or a search index lands in the server build.
- `service-doc` currently points at `/docs`; it should keep pointing at
  the section home, not at a random guide.

## What shipped

| Piece             | Where                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| MDX (six locales) | `frontend/content/docs/` — sidebar groups: Start (quickstart, concepts), Plugins (why-plugins, six publish formats), Develop, Use dsh.fish (hub, cli, submit), Reference (scoring, api) |
| Source loader     | `frontend/src/pages/docs/source.ts` — `defineDocs` rewritten by Vite; never `getText('raw')`                  |
| Routes            | `:locale?/docs`, `:locale?/docs/*`, `:locale?/docs/search` (search **before** the splat)                      |
| Shell             | `widgets/docs-shell` — in-column sidebar + TOC; mobile sheet uses `SPRING_PANEL`                              |
| Scoring           | `widgets/docs-scoring` — `DescribeScoring` via the page loader                                                |
| Markdown          | `import.meta.glob('…mdx?raw')` in `pages/docs/raw.ts`; Worker has no `content/docs`                           |
| Search JSON       | `/docs/search` — titles and descriptions only; Orama and Shiki stay out of the Worker                         |
| Code fences       | `rehypeCodeOptions: false` — no GitHub-themed token spans; fences match the catalog readme                    |
| Video             | `widgets/docs-media` + `public/docs/video` — 11 short per-section clips × 6 locales (mp4 + poster), localized caption and transcript      |

Every shipped guide has a physical file for all six locales. English fallback
remains a route-safety mechanism; metadata and sitemap alternates are limited to
translations that physically exist.

The sidebar was later restructured into the reading journey above: the
`install` group became `plugins` (why plugins matter, then one page per
publish format — the `publish/` folder keeps its path but titles itself
"Plugin formats") and `use` (hub, cli, submit). Separator titles stay i18n
keys (`docs.nav.plugins`, `docs.nav.use` in `pages/docs/source.ts` and
`widgets/docs-shell`), and each video page now embeds several ~20-second
clips at the section they demonstrate rather than one long video at the top.

## Implementation order

No dates. Each step is a gate for the next:

1. Write the missing P0 pages in MDX (English first), still renderable by
   a thin React Router splat route **without** Fumadocs UI if needed.
2. Add the Vite MDX source loader, `:locale?/docs/*`, `requireLocale`, and
   sitemap enumeration. Scoring stays a React island.
3. Scope docs chrome to that splat: first-party sidebar and TOC, no
   global Fumadocs `RootProvider` on the catalog.
4. Wire docs search at `/docs/search`, not `/api/search`.
5. Translate MDX for the locales that already have catalog copy. Fallback
   to English is allowed; a blank locale folder is not.
6. Turn on markdown negotiation for `/docs/*` so agents that already fetch
   plugin pages as Markdown can fetch the human docs the same way.

Steps 1–6 are done.

## References

- [Fumadocs](https://github.com/fuma-nama/fumadocs)
- [React Router installation](https://www.fumadocs.dev/docs/manual-installation/react-router)
- [Fumadocs i18n on React Router](https://www.fumadocs.dev/docs/internationalization/react-router)
- [Local Markdown (Workers-safe compile)](https://www.fumadocs.dev/docs/integrations/content/local-md)
- [`../seo/recommendations.md`](../seo/recommendations.md) — "content that is not a catalog row"
- [`../seo/url-strategy.md`](../seo/url-strategy.md)
- [`../frontend/i18n.md`](../frontend/i18n.md)
- [`adr-0003-locale-prefix-with-preference-cookie.md`](adr-0003-locale-prefix-with-preference-cookie.md)
