# dsh.fish

The plugin hub for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —
discovery, distribution and one-command install for every kind of artifact the
harness can load.

The harness is built on "everything is a plugin" but ships no registry: its
README asks authors to tag repositories with the `dsh-plugin` topic and leaves
discovery there. This is that registry, plus the install path on both ends.

## What it indexes

Six artifact kinds, each taken from something the harness really loads, each
with its own install mechanism:

| Kind | What it is | How it installs |
|---|---|---|
| **Bundle** | npm package declaring `dsh.bundle.patch` | `dsh plugin --profile <p> add <spec>` |
| **Profile** | ordered `dsh.profile.bundles` stack | one `add` per bundle, in order |
| **Skill** | `SKILL.md` bundle or flat Markdown | files written under `$DSH_HOME/skills` |
| **MCP server** | external Model Context Protocol server | a `dsh-mcp-client` row in the profile patch |
| **Agent preset** | directory holding one `agent.cordis.yml` | written to `$DSH_HOME/.agent-presets/<id>` |
| **Hook bridge** | Claude Code / Codex hook bridge | a bridge plugin row in the profile patch |

## Two ways in

**From a browser** — search, filter by kind and category, read the plan, copy the
command.

**From inside your agent** — install the hub's own plugin and let the agent do it:

```sh
dsh plugin --profile web add github:stvlynn/dsh.fish#path:packages/dsh-plugin-hub
```

It registers four tools: `hub_search`, `hub_show`, `hub_install` and
`hub_account`. Signing in uses the OAuth device flow — the plugin prints a code,
you approve it in a browser, and the harness gets a token.

Both paths resolve the **same** install plan from the same domain code, so the
command on the website and the one the agent runs cannot drift apart.

## Repository layout

```
backend/    Domain-Driven Design: domain, application, infrastructure, interfaces
frontend/   Feature-Sliced Design: app, pages, widgets, features, entities, shared
packages/
  dsh-plugin-hub/   the `dsh-hub` bundle users install into their harness
docs/       architecture, layer conventions, operations, ADRs
```

Both halves deploy as **one Cloudflare Worker**: Hono at `/api/*`, React Router
SSR everywhere else, D1 for the catalog and Better Auth's tables, KV for
sessions and rate limiting, and a Cron Trigger that re-crawls every six hours.

## Development

```sh
pnpm install
pnpm --filter @dsh-fish/backend run db:generate   # regenerate migrations
pnpm run db:migrate:local                          # apply to local D1
pnpm run dev                                       # http://localhost:5173
```

Quality gates:

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```

Deployment, bindings and secrets: [`docs/operations/deployment.md`](docs/operations/deployment.md).

## Documentation

Start with [`AGENTS.md`](AGENTS.md) (same file as `CLAUDE.md`) for the ground
rules, then:

- [`docs/project/architecture.md`](docs/project/architecture.md) — system architecture and the artifact taxonomy
- [`docs/decisions/adr-0001-plugin-hub-architecture.md`](docs/decisions/adr-0001-plugin-hub-architecture.md) — why it is built this way
- [`docs/frontend/`](docs/frontend/README.md) — FSD conventions
- [`docs/backend/`](docs/backend/README.md) — DDD conventions

## License

MIT
