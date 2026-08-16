# Architecture

> System architecture for **dsh.fish**, the plugin hub for DeepSeek Harness.

## What this system is

dsh.fish is a discovery, distribution and installation service for every kind of
artifact the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
can load. The harness has no registry of its own — its README asks authors to
tag repositories with the `dsh-plugin` topic and leaves discovery there. This
project is that missing registry, plus the install path on both ends: a website
a human browses, and a harness plugin an agent drives.

## Technology stack

| Concern | Choice |
|---|---|
| Runtime | Cloudflare Workers (`nodejs_compat`) |
| Frontend | React 19 + React Router 8 (SSR), Tailwind CSS 4, beui components |
| Backend | Hono, layered DDD |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| Cache / secondary storage | Cloudflare KV |
| Auth | Better Auth (`better-auth-cloudflare`), GitHub OAuth + email/password + OAuth device grant |
| Scheduled work | Workers Cron Triggers |

## Deployment topology

One Worker serves both halves of the product.

```text
                    ┌──────────────────────────────────────────┐
   browser ────────▶│  Worker (dsh.fish)                       │
   harness ────────▶│                                          │
                    │   /api/*  → Hono app (interfaces layer)  │
                    │   /*      → React Router SSR handler     │
                    │   cron    → IngestCatalog use case       │
                    └───────────────┬──────────────────────────┘
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                    D1 (catalog +        KV (sessions,
                    Better Auth)         rate limiting,
                                         crawl cursor)
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

| Layer | Contents |
|---|---|
| `domain/` | `Artifact` aggregate, `ArtifactKind`, `ArtifactPayload`, `InstallPlan`, `Submission`, `Account`, repository ports |
| `application/` | Use cases (`SearchArtifacts`, `ResolveInstallPlan`, `SubmitArtifact`, `IngestCatalog`, …), DTOs, indexer ports |
| `infrastructure/` | D1 repositories, Better Auth composition, GitHub/npm indexers, the container |
| `interfaces/` | Hono routers, Zod request schemas, the domain-error → HTTP mapping |

The domain has no dependency on Hono, Drizzle, Better Auth or Workers types
beyond value objects. `infrastructure/container.ts` is the composition root and
is built **per request**, because D1 and KV bindings arrive per request.

### Frontend — Feature-Sliced Design

`frontend/src/`, imports flowing only downward.

| Layer | Contents |
|---|---|
| `app/` | `root.tsx`, `routes.ts`, global styles |
| `pages/` | One slice per route; composes widgets, owns loaders |
| `widgets/` | `site-header`, `catalog-grid`, `catalog-filters`, `install-panel` |
| `features/` | `account-menu` — the signed-in identity, and the actions on it |
| `entities/` | `artifact` — types re-exported from the backend DTO contract, plus `ArtifactCard`, `KindChip` |
| `shared/` | beui components (`ui/motion/`, `ui/avatar`), motion tokens, i18n messages, auth client, `hub-context` |

The account slot in the header is the whole signed-in affordance: signed out it
is the sign-in call to action; signed in it is the portrait Better Auth cached
from the OAuth profile — GitHub's, for most accounts — opening a beui popover
that carries the dashboard link and sign-out. Nothing about the account is
duplicated in the navigation, at any width.

React Router requires every route module to live inside `appDirectory`, so
`appDirectory` is `src` — the whole FSD tree. `src/root.tsx` and `src/routes.ts`
are one-line re-exports of the real modules in the `app` layer, so the framework
convention is satisfied without moving application setup out of its layer.

## The artifact taxonomy

Six kinds, each taken from something the harness actually loads, each with a
distinct install mechanism. `ArtifactKind` names them; `buildInstallPlan` owns
how each reaches a machine.

| Kind | What it is | How it installs |
|---|---|---|
| `bundle` | npm package declaring `dsh.bundle.patch` | `dsh plugin --profile <p> add <spec>` |
| `profile` | ordered `dsh.profile.bundles` stack | one `add` per bundle, in order |
| `skill` | `SKILL.md` bundle or flat Markdown | files written under `$DSH_HOME/skills` |
| `mcp-server` | external MCP server | a `dsh-mcp-client` row in the profile patch |
| `agent-preset` | directory holding one `agent.cordis.yml` | written to `$DSH_HOME/.agent-presets/<id>` |
| `hook-bridge` | Claude Code / Codex hook bridge | a bridge plugin row in the profile patch |

## How a repository becomes a row

The `dsh-plugin` topic is a seed list, not a manifest: most of what carries it
is an application that mentions the harness. So a repository is classified by
what it holds, in this order, and a repository that answers none of the three
yields nothing — the harness would load nothing from it either.

| Probe | Row |
|---|---|
| `package.json` with `dsh.profile.bundles` | `profile` |
| `package.json` with `dsh.bundle` | `bundle` |
| `SKILL.md` with `name` + `description` frontmatter | `skill` |
| `agent.cordis.yml` | `agent-preset` |

Those probes run against the repository root (or an explicit subdirectory on
submit). A monorepo whose bundle lives under `packages/` — this project's own
`dsh-hub` plugin included — is therefore submitted as
`github:<owner>/<repo>/<path>`, and `packageSpec` emits pnpm's
`#path:<dir>` selector so `dsh plugin add` installs that package rather than
the root.

Those probes run before anything else is fetched, so a repository that is not a
plugin costs three reads and no API quota — that ordering is what makes it
affordable to page deep into a topic of several thousand repositories.

Categories are resolved separately, and never block a row: a valid
`dsh.hub.categories` declaration wins, otherwise `category-inference.ts` reads
topics, keywords and the description against a fixed token table, and `other` is
the floor. See ADR-0001 §8.

## Cross-cutting concerns

### The install plan is the contract

`domain/artifact/install-plan.ts` is the single place that knows how each kind
installs. It returns both `steps` (machine-executable) and `manualCommands`
(copy-paste). The website renders the second; the `dsh-hub` plugin executes the
first. Because neither surface authors its own commands, a documented command
and an agent-driven install cannot drift apart.

### Secrets are referenced, never stored

An MCP server's payload carries a credential *reference* — a POSIX environment
variable name — never a value, mirroring the harness's own credentials doctrine.
That is what makes a catalog row safe to serve publicly and safe to render in a
configuration UI.

### Two authentication channels, unequal trust

A browser session cookie and a device-grant bearer token both resolve to the
same account, but `Actor.channel` distinguishes them. `requireInteractiveSession`
restricts account-shaped writes — submitting, claiming — to a real browser
session, so a harness token cannot publish on a user's behalf.

### Errors

The domain throws `DomainError` with a code; `interfaces/http/error-mapper.ts`
maps codes to HTTP statuses and emits the one envelope described in
[`backend/api-conventions.md`](../backend/api-conventions.md). Unexpected
failures never leak their message — it may carry a binding name or a token.

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

### One accent, and kinds are named not coloured

Artifact kinds are distinguished by their label, not by a hue. Six per-kind
colours competed with the accent and encoded nothing a reader could learn; the
chip already says "MCP server" in words, which is unambiguous, translatable and
readable without colour vision. Colour is reserved for the primary action and
the verified badge.

### No hardcoded copy

`frontend/src/shared/config/messages.ts` holds every user-facing string. The
backend sends message *keys* (`artifactKind.bundle.label`,
`install.warning.buildAllowance`), never prose, so the catalog stays
language-neutral in the database.

## Related documents

- [`decisions/adr-0001-plugin-hub-architecture.md`](../decisions/adr-0001-plugin-hub-architecture.md)
- [`operations/deployment.md`](../operations/deployment.md)
- [`frontend/README.md`](../frontend/README.md), [`backend/README.md`](../backend/README.md)
