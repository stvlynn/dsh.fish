# Architecture

> System architecture for **dsh.fish**, the plugin hub for DeepSeek Harness.

## What this system is

dsh.fish is a discovery, distribution and installation service for every kind of
artifact the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
can load. The harness has no registry of its own — its README asks authors to
tag repositories with the `dsh-plugin` topic and leaves discovery there. This
project is that missing registry, plus the install path on three ends: a website
a human browses, a CLI they copy from an artifact page, and a harness plugin
an agent drives.

## Technology stack

| Concern                   | Choice                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- |
| Runtime                   | Cloudflare Workers (`nodejs_compat`)                                            |
| Frontend                  | React 19 + React Router 8 (SSR), Tailwind CSS 4, beui components                |
| Backend                   | Hono, layered DDD                                                               |
| Database                  | Cloudflare D1 (SQLite) via Drizzle ORM                                          |
| Cache / secondary storage | Cloudflare KV                                                                   |
| README localization       | Cloudflare Agents SDK + OpenCode Go (`deepseek-v4-flash` → `hy3` → `mimo-v2.5`) |
| Auth                      | Better Auth (`better-auth-cloudflare`), GitHub OAuth + OAuth device grant       |
| Scheduled work            | Workers Cron Triggers                                                           |

## Deployment topology

One Worker serves both halves of the product.

```text
                    ┌──────────────────────────────────────────┐
   browser ────────▶│  Worker (dsh.fish)                       │
   harness ────────▶│                                          │
                    │   /api/*  → Hono app (interfaces layer)  │
                    │   /*      → React Router SSR handler     │
                    │   cron    → IngestCatalog use case       │
                    └───────┬───────────┬───────────┬──────────┘
                            ▼           ▼           ▼
                     D1 (catalog)    KV (sessions,   README i18n Agent
                                     crawl state,    → OpenCode Go
                                     ask limiter)
                                          │
                                          ▼
                                    Ada Fast query
                                    (GitHub ask)
```

Sharing an origin is a deliberate choice, not an accident of packaging:

- Better Auth's session cookie needs no cross-subdomain configuration.
- The browser makes no CORS preflight before a search.
- **Loaders call use cases in-process.** A server-rendered artifact page costs
  one D1 round trip rather than an HTTP hop back into the same Worker. See
  `frontend/src/shared/api/hub-context.ts`.

## Module boundaries

### Backend — Domain-Driven Design

`backend/src/`, dependencies pointing inward.

| Layer             | Contents                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`         | `Artifact` aggregate, `ArtifactKind`, `ArtifactPayload`, `InstallPlan`, `Submission`, `Account`, `ogImageUrl`, the `quality-score` value object, repository ports |
| `application/`    | Use cases (`SearchArtifacts`, `ResolveInstallPlan`, `SubmitArtifact`, `IngestCatalog`, …), DTOs, indexer ports                                                    |
| `infrastructure/` | D1 repositories, Better Auth composition, GitHub/npm/awesome-list indexers, the container                                                                         |
| `interfaces/`     | Hono routers, Zod request schemas, the domain-error → HTTP mapping                                                                                                |

The domain has no dependency on Hono, Drizzle, Better Auth or Workers types
beyond value objects. `infrastructure/container.ts` is the composition root and
is built **per request**, because D1 and KV bindings arrive per request.

### Frontend — Feature-Sliced Design

`frontend/src/`, imports flowing only downward.

| Layer       | Contents                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`      | `root.tsx`, `routes.ts`, global styles                                                                                                                                                                                                                                                 |
| `pages/`    | One slice per route; composes widgets, owns loaders                                                                                                                                                                                                                                    |
| `widgets/`  | `site-header`, `site-footer`, `catalog-grid`, `catalog-filters`, `catalog-pagination`, `install-panel`, `readme-badge`, `artifact-reviews`, `artifact-ask`, `community-toasts`, `docs-shell`, `docs-scoring`                                                                           |
| `features/` | `account-menu` — the signed-in identity and the actions on it; `locale-switcher` — the language of the page you are on; `catalog-search` — the header palette's live query against `GET /api/v1/artifacts`; `ask-artifact` — POST `/api/v1/artifacts/:id/ask` and the streaming thread |
| `entities/` | `artifact` — types re-exported from the backend DTO contract, plus `ArtifactCard`, `KindChip`, `AuthorCard`, `artifactLd`                                                                                                                                                              |
| `shared/`   | beui components (`ui/motion/`, `ui/avatar`, `ui/animated-number`), motion tokens, `config/i18n` (locales and catalogs), `lib/seo`, `lib/analytics`, auth client, `hub-context`                                                                                                         |

The account slot in the header is the whole signed-in affordance: signed out it
is the sign-in call to action; signed in it is the portrait Better Auth cached
from the GitHub OAuth profile, opening a beui popover that carries the dashboard
link and sign-out. Nothing about the account is duplicated in the navigation,
at any width. Sign-in is GitHub only; there is no email/password path.

The plugin page header gives the repository author their own card, in the
column the install panel occupies below: beui's Avatar, the name the catalog
stored, and an outbound link to the profile. The source link sits directly
under that portrait — two facts about where the plugin comes from, stacked,
rather than a source row parked beside the install commands. A GitHub
profile URL is also GitHub's `{login}.png`, so the portrait is not a second
stored image.

That same column, beside the readme, stacks three rail cards: the install
panel, the README badge snippet, then community reviews. Ask is a
GitHub-only, feature-flagged **column** (`ARTIFACT_ASK_ENABLED`) that
sits beside the plugin page rather than in the rail. Opening it rounds
the page's right corners where they meet the column and drops
`--shadow-column`; there is no overlay and no backdrop blur. The site
footer stays inside that main column so it does not drop out under the
Q&A pane. The header rail carries a "you might ask" card — three openers
drawn from a twelve-question pool by a seed derived from the plugin id, so
the draw survives hydration; clicking one opens the column and asks it. npm and
flagged-off Workers omit the control entirely. The Worker proxies
DeepWiki Ada (Fast) as SSE — the browser never
calls `api.devin.ai`. See [`../decisions/adr-0004-artifact-ask-via-ada.md`](../decisions/adr-0004-artifact-ask-via-ada.md).

Reviews are a
permanent card in that rail — empty or not — so a long readme cannot bury
the comments below the fold of the document.

`community-toasts` is the only widget mounted outside `<Outlet>`: three
invitations — the Discord room, the maintainer's feed, and the issue tracker —
that arrive once, after the page has had a moment to itself, and are dismissed
for good one at a time. Which of them a reader still has is decided in the root
loader from a cookie, for the reason the theme uses one: a client-side store
would render the surface and then hide it, and only a cookie can keep a retired
toast out of the response. Living outside the route outlet is what keeps a
navigation from replaying the entrance or resurrecting a dismissal.

The header control labelled "Search plugins" queries `GET /api/v1/artifacts`
as the reader types — the same `SearchArtifacts` use case the browse page
loader runs — and Enter takes that query to `/browse?q=`. An empty palette
is still the destinations the bar already lists; a typed query is catalog
search, not a fuzzy filter of those four links.

### Product documentation

Reader-facing guides live under `/docs/*`, not in the repo `docs/` tree.
MDX is compiled at **build time** (`fumadocs-mdx` Vite plugin +
`fumadocs-core` loader) so the Worker never `eval`s compiled output and
never reads `content/docs` from disk. Search JSON is
`:locale?/docs/search` because `/api/*` is Hono.

`pages/docs` owns the routes and the source module. `widgets/docs-shell`
is in-column chrome beside `SiteHeader`. `widgets/docs-scoring` renders
`DescribeScoring` so the documented formula cannot drift from
`GET /api/v1/scoring`. `widgets/docs-media` renders controlled, responsive
video with a localized caption and transcript. `fumadocs-ui` is not a dependency: theme is the
existing cookie on `<html>`, and the palette stays hue 263.

Two same-layer imports are allowed so the slug list exists once:

- `pages/markdown` → `pages/docs` public API (`productDocsMarkdown`, `productDocsPaths`)
- `pages/seo` → `pages/docs` public API (`productDocsMarkdown`, `productDocsPaths`) for `/docs/llms-full.txt`
- `pages/seo` → `pages/docs/source` (`docsSitemapEntries`, `docsNav`, `docsSitemapPaths`) — those helpers cannot sit on the public API, because `defineDocs` is a Vite macro and the markdown unit tests import `@/pages/docs` without the plugin

Fumadocs uses dot-suffix locale files and React Router owns the URL prefix.
`productDocsLocales` checks physical MDX files so page metadata and the sitemap
never advertise an English fallback as a translation.

See [`../decisions/adr-0005-product-docs-with-fumadocs.md`](../decisions/adr-0005-product-docs-with-fumadocs.md).

React Router requires every route module to live inside `appDirectory`, so
`appDirectory` is `src` — the whole FSD tree. `src/root.tsx` and `src/routes.ts`
are one-line re-exports of the real modules in the `app` layer, so the framework
convention is satisfied without moving application setup out of its layer.

## The discovery surface

A registry is a search product with no traffic of its own: nobody bookmarks a
plugin page, they find it. That makes the crawler-facing surface part of the
architecture rather than a finishing touch.

**Six languages, in the URL, with a memory.** Every reader-facing route
carries an optional `:locale?` first segment, and each loader passes it through
`requireLocale`. An explicit switcher choice is stored in the `dsh_locale`
cookie, so a later bare-URL visit is forwarded to the reader's prefix with a 302. See `docs/decisions/adr-0003-locale-prefix-with-preference-cookie.md`.

**Two crawlable facet axes.** `/kind/:kind` and `/category/:category` are real
pages, not query strings, because that is the form an engine will rank and the
form the footer can link from every page on the site.

**Resource routes.** `/robots.txt`, `/sitemap.xml` and the two sitemap files
it indexes, plus `/llms.txt`, `/docs/llms.txt` and `/docs/llms-full.txt`, are
React Router routes with a `loader` and no component, so they resolve their
data through the same container as every page — the artifact sitemap reads
`ListSitemapEntries`, an application use case over a dedicated
`ArtifactRepository.listForSitemap` projection rather than over search. The
llms.txt files are curated agent overviews (llmstxt.org v2); they do not
enumerate the catalog.

Full treatment in [`../seo/README.md`](../seo/README.md); language conventions
in [`../frontend/i18n.md`](../frontend/i18n.md).

## The artifact taxonomy

Six kinds, each taken from something the harness actually loads, each with a
distinct install mechanism. `ArtifactKind` names them; `buildInstallPlan` owns
how each reaches a machine.

| Kind           | What it is                               | How it installs                             |
| -------------- | ---------------------------------------- | ------------------------------------------- |
| `bundle`       | npm package declaring `dsh.bundle.patch` | `dsh plugin --profile <p> add <spec>`       |
| `profile`      | ordered `dsh.profile.bundles` stack      | one `add` per bundle, in order              |
| `skill`        | `SKILL.md` bundle or flat Markdown       | files written under `$DSH_HOME/skills`      |
| `mcp-server`   | external MCP server                      | a `dsh-mcp-client` row in the profile patch |
| `agent-preset` | directory holding one `agent.cordis.yml` | written to `$DSH_HOME/.agent-presets/<id>`  |
| `hook-bridge`  | Claude Code / Codex hook bridge          | a bridge plugin row in the profile patch    |

## How a repository becomes a row

The `dsh-plugin` topic is a seed list, not a manifest: most of what carries it
is an application that mentions the harness. So a repository is classified by
what it holds, in this order, and a repository that answers none of the probes
yields nothing — the harness would load nothing from it either.

| Probe                                               | Row            |
| --------------------------------------------------- | -------------- |
| `package.json` with `dsh.profile.bundles`           | `profile`      |
| `package.json` with `dsh.bundle`                    | `bundle`       |
| `package.json` with `dsh.hub.kind` + `dsh.hub.mcp`  | `mcp-server`   |
| `package.json` with `dsh.hub.kind` + `dsh.hub.hook` | `hook-bridge`  |
| `SKILL.md` with `name` + `description` frontmatter  | `skill`        |
| `agent.cordis.yml`                                  | `agent-preset` |

The MCP server and hook bridge kinds have no manifest convention in the harness
— they install as files and rows under `$DSH_HOME`, not as a package layer —
so their `dsh.hub` declaration in package.json is the source of truth rather
than advisory metadata. A declaration is a claim the package must back: the
kind needs its block, and the block must satisfy the payload rules of
`artifact-payload.ts` (`assertPayloadMatchesKind`). A declared-but-malformed
manifest — a kind without its block, a stdio server without a command, a
`settingsPath` escaping the repository, a `hub.kind` outside the six kinds or
naming a content-proven kind whose proof is absent — is a `DomainError`, which
the sweep records as skipped and the submission endpoint returns to the
submitter. Minimal declarations:

```jsonc
// mcp-server
{
  "dsh": {
    "hub": {
      "kind": "mcp-server",
      "mcp": {
        "serverName": "github",
        "transport": "stdio", // or "streamable-http" with "url"
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "credentials": [{ "envName": "GITHUB_TOKEN", "required": true }]
      }
    }
  }
}

// hook-bridge
{
  "dsh": {
    "hub": {
      "kind": "hook-bridge",
      "hook": { "dialect": "claude-code", "settingsPath": "hooks/settings.json" } // or "codex"
    }
  }
}
```

Those probes run before anything else is fetched, so a repository that is not a
plugin costs three reads and no API quota — that ordering is what makes it
affordable to walk the whole topic. A submission may carry a `kindHint`; it
rotates the probe order so the hinted file probe reads first (`skill` reads
`SKILL.md` before package.json), but it never substitutes for proof — a hinted
probe that finds nothing falls through to the rest, and a snapshot whose
detected kind differs from the submitted kind is still rejected. The walk runs
in star-range shards, because the search API caps any single query at 1000
results and the topic is several times that; a shard that saturates the
ceiling is split further, by created date once its star range cannot be halved.

The probes live in one place, `infrastructure/ingestion/repo-prober.ts`, and
three discovery channels feed it. The topic crawl is the seed set above.
`NpmIndexer` searches the registry's conventional keywords and confirms each
candidate against its published manifest. `AwesomeListIndexer` aggregates the
community's machine-readable curated lists — the catalog behind
awesome-dsh-plugin.com and Oh-My-DSH's scan — because the topic tag only
reaches authors who knew to add it. A list entry is a candidate, not an
artifact: the repository goes through the same prober, and a listed repository
with no loadable manifest is skipped exactly like a topic repository is.
Provenance is kept on the row rather than in a side table — a list-surfaced
artifact records the list in `source.via` (the `source` column is JSON, so
this costs no migration), and a later refresh from any channel merges the set
instead of replacing it. Both GitHub-backed channels persist a resume cursor
in KV (`crawler:github:shard`, `crawler:awesome-list:list`), so each cron run
spends only its own slice of the subrequest budget.

Categories are resolved separately, and never block a row: a valid
`dsh.hub.categories` declaration wins, otherwise `category-inference.ts` reads
topics, keywords and the description against a fixed token table, and `other` is
the floor. See ADR-0001 §8.

Every classified repository is also pinned to the exact commit it was scanned
from: the indexer resolves the default-branch HEAD once per artifact (the same
lookup that pins `source.commit`), and the sweep stores it on
`artifacts.source_commit_sha`. That SHA is the scan's provenance — the detail
DTO exposes it as `sourceCommitSha` with a browsable `sourceCommitUrl`, the
install plan DTO carries it as `scannedAtCommit`, and the artifact page links
"Indexed at commit" to the commit on GitHub, so a reader can diff what the
registry read against what the repository serves now. It is display-only;
executing installs pinned to the SHA is a separate decision.

When an artifact is created or its README Markdown changes, both ingestion
paths — scheduled
discovery and an ownership-verified submission — call the same application
port to durably accept localization work. Its Cloudflare Agents SDK adapter
addresses one `ReadmeI18nAgent` instance per artifact, then queues one task per
site locale. Per-artifact sharding prevents one failing README from blocking
the rest of the catalog. The task reads the current source Markdown from D1,
uses OpenCode Go's chat-completions endpoint to translate
human prose while preserving Markdown, code, links and identifiers, and stores the result in
`artifact_readme_translations`. Requests walk an ordered model fallback chain
(`deepseek-v4-flash`, `hy3`, `mimo-v2.5`) so one model's exhausted usage
window does not stall the catalog.

Every translation carries a SHA-256 hash of its upstream README plus an opaque
translation-policy version. The detail
use case serves generated Markdown only when that hash still matches the
current catalog row; pending, failed and stale translations expose the original
README instead. Queue acceptance is deduplicated by artifact, locale and hash.
The Agent performs bounded retries itself and records terminal failures in D1,
because the Agents SDK queue has no dead-letter queue.

A separate minutely Cron advances a versioned KV cursor over every stored,
non-empty README in bounded pages. Therefore a deployment that changes the
translation policy starts a complete stock backfill on its next trigger while
the existing hourly ingestion Cron remains unchanged. Cursor writes happen
only after a page is accepted, and only when the page actually moved the
cursor; repeating a page after a failure is safe because
the per-artifact Agents deduplicate it. The hourly Cron also reschedules
artifacts whose `failed` rows have been stale for six hours, since the
forward-only cursor never revisits them and the provider's usage window has
reset by then. That retry scan reads every README-bearing row, so the minutely
Cron skips it — once an hour is often enough for a six-hour staleness window.

## Quality score, maintenance status and star velocity

Every artifact carries a public, reproducible quality score. The formula lives
in one domain value object, `domain/artifact/quality-score.ts`, and the same
`SCORING_MODEL` constant is served as JSON by `GET /api/v1/scoring` — so the
documented formula and the executed formula cannot drift, and anyone can
recompute what the site shows.

Three dimensions, each 0–100, blended into a 0–100 score:

```
score = round(0.4 · popularity + 0.3 · maintenance + 0.3 · quality)
```

| Dimension     | Exact rule                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `popularity`  | `raw = installs·3 + stars + downloads/10`; `round(100 · log10(1+raw) / log10(1+10000))`, capped at 100. Installs weigh most because they are the only signal the hub observes itself. |
| `maintenance` | Derived from `maintenanceStatus`: `active` → 100, `slowing` → 60, `stale` → 30, `abandoned` → 0.                                                                                      |
| `quality`     | Additive trust points: verified 50, has readme 25, declares a license 15, names an author 10.                                                                                         |

The grade is a threshold read of the score: `S` ≥ 85, `A` ≥ 70, `B` ≥ 50,
otherwise `C`.

`maintenanceStatus` buckets the age of `updatedAt`: `active` ≤ 30 days,
`slowing` ≤ 90, `stale` ≤ 365, `abandoned` beyond that — and a deprecated
artifact is `abandoned` however fresh its timestamps are.

Star velocity comes from history, not from the current row: an
`IngestCatalog` sweep appends one `artifact_metrics` row (stars, downloads,
installs, `captured_at`) per artifact whose content or stats moved, and writes
nothing at all for an artifact the sweep re-found unchanged — D1 bills per row
written, and most of a sweep re-finds what the last sweep stored. The 7- or
30-day velocity is the
current star count minus the most recent snapshot taken _at least_ that many
days ago, and 0 when history does not reach back that far — a young artifact
is unmeasured, not "rising". The sweep stores both windows on
`artifacts.star_velocity_7d` / `star_velocity_30d` — and, in the same UPDATE,
the fresh stars/downloads counters, so a stats-only sweep needs no catalog
rewrite — so `sort=rising` is a
column scan (7-day velocity, then the stored `popularity` column) rather than a
history join per request. `popularity` is the same number `listRank` /
`Artifact.popularity` compute — hub installs weighted over copied stars,
verified boost, deprecated decay — written on every catalog save, every
metrics snapshot, and every install increment, so a listing `ORDER BY` does
not re-evaluate that expression over the matching table. Velocity is hub-derived state kept outside
`ArtifactStats`, so a velocity tick does not count as a public-page change and
churn the sitemap `lastmod`.

List and detail DTOs expose `score`, `grade`, `maintenanceStatus`,
`starVelocity7d` and `starVelocity30d`.

### Catalog listing pagination

Browse, kind, and category pages keep **offset pagination** (`?offset=`,
default 24). The HTML listings must be crawlable as real `<a href>`s, and
Workers SSR already calls the use case in-process, so a cursor token would
break the SEO contract without saving a round trip.

The expensive part was never returning 24 rows; it was D1 reading wide
README/payload columns and sorting on an expression, billed as rows-read.
Listings now:

1. `ORDER BY artifacts.popularity` (indexed with `deprecated`, and with `kind`
   for `/kind/:kind`).
2. Select a card projection that omits `readme_markdown`.
3. Issue `COUNT(*)` and the page as one D1 `batch`, because the Worker-to-D1
   hop dominates.

`GET /api/v1/catalog/snapshot` still returns the whole public catalog as one
KV-cached document — that is the third-party sync contract, not a browse
path. Rebuilding it also uses the card projection so a Worker isolate does
not load every README into memory.

Cursor pagination stays on the ingest/localization backfills, which already
resume from KV. Do not serve browse by slicing the snapshot in the Worker:
that would duplicate `SearchArtifacts` filters and drift from D1.

## Cross-cutting concerns

### The install plan is the contract

`domain/artifact/install-plan.ts` is the single place that knows how each kind
installs. It returns both `steps` (machine-executable) and `manualCommands`
(copy-paste). The website renders the second; the `dsh-hub` plugin and
`@dsh-fish/cli` execute the first. The first manual command is always
`npx @dsh-fish/cli add <id> --profile <p>`, so a copied line actually installs
kinds the harness launcher does not cover (skills, MCP rows, presets, hooks).
Because no surface authors its own commands, a documented command and an
agent-driven install cannot drift apart.

### Secrets are referenced, never stored

An MCP server's payload carries a credential _reference_ — a POSIX environment
variable name — never a value, mirroring the harness's own credentials doctrine.
That is what makes a catalog row safe to serve publicly and safe to render in a
configuration UI.

### Two authentication channels, unequal trust

A browser session cookie and a device-grant bearer token both resolve to the
same account, but `Actor.channel` distinguishes them. `requireInteractiveSession`
restricts account-shaped writes — submitting, claiming — to a real browser
session, so a harness token cannot publish on a user's behalf.

The `Account` the domain sees carries no source-host identity. Whether a
submitter owns a repository is answered by `LinkedIdentityReader`, which reads
the OAuth link out of Better Auth's `accounts` table at the moment the claim is
made. Keeping it off the account is deliberate: see ADR-0001 §7.

### Errors

The domain throws `DomainError` with a code; `interfaces/http/error-mapper.ts`
maps codes to HTTP statuses and emits the one envelope described in
[`backend/api-conventions.md`](../backend/api-conventions.md). Unexpected
failures never leak their message — it may carry a binding name or a token.

### Analytics is gtag, from a Worker var

Production HTML loads GA4 via the official gtag snippet. The measurement ID is
the `GA_MEASUREMENT_ID` var in `frontend/wrangler.jsonc` — public, like
`INDEXNOW_KEY`, because it appears in every page source. The root loader reads
it from the Worker env and the Layout emits the snippet; React Router
navigations then send `page_view` themselves, with automatic first-view
disabled so a client-side transition is not counted twice.

Local and e2e builds do not load gtag even when the var is present. The
anonymous HTML cache does not vary on User-Agent, so a crawler and a reader of
the same URL see the same snippet.

### Theming is server-rendered from a cookie

The theme class on `<html>` is written by the root loader from a `theme` cookie,
not by an inline script reading `localStorage`. React owns the document element
during hydration and reconciles away any class a script set before it, which
both reverts the theme and raises a hydration mismatch — a cookie is the only
theme store the server can read, so client and server agree from the first byte.
With no cookie, no class is emitted and the stylesheet follows
`prefers-color-scheme`; an explicit choice writes `light` or `dark`, and `light`
is what lets a user override a dark OS setting.

Related: the raw colour properties (`--bg`, `--fg`, …) deliberately do not share
names with the `@theme inline` keys that consume them. `inline` substitutes the
resolved value straight into each utility, so a theme key defined as
`var(--color-background)` bakes the light value into `bg-background` and no dark
override can reach it.

### The palette is derived from the brand mark, not chosen

The one accent is the whale's own blue. `icons/whale-brand.png` is hue 263 over
two thirds of the mark — `oklch(0.529 0.257 263)` for the body, the same hue at
`0.320 0.164` for its shadow — and the plugin tiles on the social card are drawn
in that hue too, so the accent is hue 263 at whatever lightness each theme can
carry. The whale's cyan belly is part of the artwork and is not a second accent
the UI may spend.

Every neutral shares one cool hue, because the ground the brand is drawn on is
cool: the social card is `oklch(0.148 0.035 242)`. An earlier palette mixed a
warm paper ground with a cool foreground, which left the greys disagreeing with
each other. Dark mode's ground now sits close to the card's own value, so
arriving from a shared link is continuous rather than a step onto a lighter,
flatter page.

`app/styles/palette.test.ts` holds the authored values to what a stylesheet
cannot check for itself: that every colour is inside sRGB, that the pairs the UI
renders meet their contrast threshold, and that the dark block — which the
cascade forces to be written twice — says the same thing both times.

The social cards inline the same tokens, so regenerate them with
`pnpm --filter @dsh-fish/frontend run og:build` after any palette change.

### One accent, and kinds are named not coloured

Artifact kinds are distinguished by their label and their mark, not by a hue.
Six per-kind colours competed with the accent and encoded nothing a reader could
learn; the chip says "MCP server" in words and carries the kind's glyph, both of
which are unambiguous, translatable and readable without colour vision. Colour
is reserved for the primary action and the verified badge.

### Catalog cards use the repository Social preview as texture

When an artifact's source has a GitHub repository, the crawler stores the
image GitHub would emit as `og:image`: an author-uploaded Social preview
(`repository-images.githubusercontent.com`) if one exists, otherwise the
generated Open Graph card (`opengraph.githubassets.com/{key}/{owner}/{repo}`).
The owner's avatar is neither, and is rejected by `ogImageUrl()` in the
domain. An npm packument contributes a preview only when its `repository`
field points at GitHub.

The URL is a domain value. Only those two hosts are accepted, so a
submission cannot paint an arbitrary tracker onto every catalog card.

On the card, the image is a blurred, desaturated, low-opacity backdrop
with a `var(--card)` gradient scrim. Type stays on `--fg` / `--muted-fg`.
Opacity, blur and the scrim are CSS variables in `app.css` — theme
differences do not scatter as `dark:` on the component.

### Counts tick through a shared NumberFlow wrapper

`@number-flow/react` is wrapped in `shared/ui/animated-number.tsx`. Compact
formatting (`1.2k`) stays in `compactNumberParts` so Cloudflare's ICU and
the browser cannot disagree at hydration. The wrapper pins `locales="en"`
and explicit fraction digits. First paint is static; digits only spin if
that instance's value later changes, so scanning the grid does not animate.

### Readmes are third-party content, rendered structurally

A plugin's readme is a crawl of somebody else's repository, so
`frontend/src/shared/ui/markdown.tsx` renders it without ever handing markup to
the DOM: `react-markdown` builds React elements from an AST, `skipHtml` drops
raw HTML rather than passing it through, every URL goes through
`defaultUrlTransform`'s protocol allowlist, and only the tags mapped in that
file can be produced. There is no `dangerouslySetInnerHTML` and no sanitiser
pass to keep ahead of attackers. `markdown.test.tsx` asserts these properties
against the emitted markup, so a refactor that re-enables raw HTML fails there.

A readme's _relative_ paths were written against its own repository, not against
this site. `sourceDocBase` and `sourceAssetBase` in
`backend/src/domain/artifact/source-ref.ts` say what such a path resolves to —
a browsable page for a document, raw bytes for an image — and reach the page
through `ArtifactDetailDto`. Both are absent for npm and submission sources,
where no root is knowable; a relative path then renders as text rather than as a
confident 404.

On a phone, a readme is also a layout problem: grid items default to
`min-width: auto`, so a wide GFM table or an unbroken DSN becomes the column
width and the page scrolls sideways. The plugin page pins `min-w-0` on the
readme column, and the markdown container sets `overflow-wrap: anywhere` for
tokens that have no break point. Tables and fences keep their own
`overflow-x-auto`. `pnpm run test:e2e` locks this at six device resolutions.

### No hardcoded copy

`frontend/src/shared/config/i18n/messages/*.json` holds every user-facing string. The
backend sends message _keys_ (`artifactKind.bundle.label`,
`install.warning.buildAllowance`), never prose, so the catalog stays
language-neutral in the database.

## Related documents

- [`decisions/adr-0001-plugin-hub-architecture.md`](../decisions/adr-0001-plugin-hub-architecture.md)
- [`decisions/adr-0005-product-docs-with-fumadocs.md`](../decisions/adr-0005-product-docs-with-fumadocs.md) — reader-facing `/docs` as a Fumadocs section
- [`operations/deployment.md`](../operations/deployment.md)
- [`frontend/README.md`](../frontend/README.md), [`backend/README.md`](../backend/README.md)
