# ADR 0001 — Plugin hub architecture

- **Status:** Accepted
- **Supersedes:** none

## Context

DeepSeek Harness is built on the premise that *everything is a plugin*, but it
ships no registry. Its README asks authors to add a `dsh-plugin` topic to their
repository and leaves discovery there. Installing means knowing a package name
in advance and typing `dsh plugin --profile <name> add <spec>` — and that only
covers bundles. Skills, MCP servers, agent presets and hook bridges each reach a
machine a different way, documented in different places, with no single surface
that knows all of them.

We need a service that indexes every artifact type, lets a person browse and
install them, and lets an agent do the same from inside a running harness.

## Decisions

### 1. One Worker serves the site and the API

Alternatives were two Workers (`dsh.fish` + `api.dsh.fish`) or a static SPA with
a separate API.

Chosen: one Worker, Hono mounted at `/api/*`, React Router SSR for everything
else.

- Same-origin means no CORS and no cross-subdomain cookie configuration for
  Better Auth — the largest source of avoidable auth bugs.
- SSR matters for a discovery site: artifact pages must be indexable, which a
  client-rendered SPA does not deliver.
- Loaders call use cases in-process, so a page render is one D1 round trip
  rather than a self-request into the same Worker.

Cost: the frontend package depends on the backend package, so the FSD/DDD split
is enforced by layering discipline and lint rules rather than by a network
boundary. Accepted — the boundary is already explicit in the directory layout.

### 2. The taxonomy is derived from the harness, not invented

`ArtifactKind` has exactly six members, each naming something the harness really
loads. The temptation was a looser "plugin" concept with free-form metadata.
Rejected: a registry whose rows do not correspond to a real loading mechanism
would list things that cannot be installed, which is the one failure a registry
must not have.

Concretely, a package that declares no `dsh` manifest is **not indexed**. The
harness activates no layer for such a package — it is a library other plugins
import — so listing it as a plugin would be false.

### 3. The install plan is a domain concept

`buildInstallPlan(artifact, target)` returns machine-executable `steps` *and*
copy-paste `manualCommands`. Both surfaces consume it: the website renders the
commands, the `dsh-hub` plugin executes the steps.

The alternative — the website hardcoding a command string and the plugin
hardcoding its own install logic — was rejected because the two would drift, and
the failure mode is silent: documentation that no longer matches what the agent
does.

### 4. The hub decides *what*; the machine decides *whether*

The plugin never blindly executes a plan. Specifically, a plan whose package
step carries `requiresBuildAllowance` is **refused** unless the caller passes
explicit consent.

This is the real security boundary. pnpm running a git dependency's `prepare`
script is arbitrary code execution at install time, outside whatever sandbox the
agent itself runs under. An agent must not grant that on a user's behalf, so the
refusal lives on the machine, not in the registry that could be compromised.

Related: git specs are pinned to a commit whenever the registry knows one, since
an unpinned `github:owner/repo` lets a later push change what runs.

### 5. Credentials are references, never values

An MCP server row carries `GITHUB_TOKEN` as a *name*; the harness resolves it
through `ctx.credentials`. This mirrors the harness's own doctrine that
configuration carries references to secrets. It is what lets the registry serve
every row publicly without any per-row secrecy analysis.

### 6. Device grant for harness authentication

A harness on a developer's machine cannot receive an OAuth redirect. Better
Auth's `deviceAuthorization()` plugin implements RFC 8628: the plugin requests a
code, prints it, and polls; the human approves in a browser they already trust.

User codes are generated as 8 digits rather than the default alphanumeric, so the
approval page can use a one-time-code input and a terminal can print something
with no `O`/`0` or `I`/`1` ambiguity to misread.

A device token is deliberately weaker than a session: `requireInteractiveSession`
blocks it from submitting or claiming artifacts.

### 7. Ingestion crawls; submission is a fast path

A cron trigger sweeps the GitHub `dsh-plugin` topic and npm every six hours, so
the registry is populated without anyone submitting anything. A signed-in user
may also submit a source; if their linked GitHub login owns the repository, the
row is published immediately, because the row is built by the same indexer a
crawl uses — waiting for review of one's own package would be friction with no
safety benefit. Everything else queues.

### 8. A row's category is inferred, never demanded

The taxonomy is the hub's, but nothing in the harness reads it, so an author has
no reason to write `dsh.hub.categories` — and almost none do. Categories are
therefore resolved in three steps: a declaration that names real categories wins
outright, otherwise they are inferred from the row's own vocabulary (topics,
keywords, description) against a fixed token table, and `other` is the floor.

Two consequences are deliberate. A category name outside the taxonomy is dropped
rather than rejected: the manifest block is advisory, and an artifact is what the
harness would load — a misspelled hint must not remove a working plugin from the
catalog. And no row is ever uncategorised, because a row no category filter can
reach is, from the browse page, not in the catalog at all.

Rejected: asking authors to declare a category before a row can be listed. That
makes the hub's taxonomy a publishing requirement for a field the harness itself
never reads, which is how a registry ends up with an empty long tail.

## Consequences

- Adding a seventh artifact kind means: one `ArtifactKind` member, one payload
  variant, one `buildInstallPlan` branch, one installer branch, and message keys.
  Nothing else changes.
- The `dsh-hub` plugin binds to `@deepseek-ai/dsh-tools` as a peer dependency and
declares its types locally, because that package is not yet installable
standalone from npm during the harness's developer preview. When it publishes
completely, `packages/dsh-plugin-hub/src/harness.d.ts` should be deleted and
the real packages added as devDependencies. The plugin's `Config` export is a
Standard Schema (`~standard`), not a defaults object: Cordis rejects a plain
object and the plugin would not start. Git installs must name the subdirectory
package (`github:owner/repo#path:packages/dsh-plugin-hub`); the repository root
is the website, not the bundle.
- D1 has no cross-statement transactions, so multi-table writes use `db.batch`,
  which D1 applies atomically.
