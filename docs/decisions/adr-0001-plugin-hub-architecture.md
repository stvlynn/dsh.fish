# ADR 0001 — Plugin hub architecture

- **Status:** Accepted
- **Supersedes:** none

## Context

DeepSeek Harness is built on the premise that *everything is a plugin*, but it
ships no registry. Its README asks authors to add a `dsh-plugin` topic to their
repository and leaves discovery there. Installing means knowing a package name
in advance and typing `dsh plugin --profile <name> add <spec>` — and that only
covers bundles. Skills and agent presets each reach a machine a different way,
documented in different places, with no single surface that knows all of them.

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

`ArtifactKind` has exactly four members, each naming something the harness really
loads. `mcp-server` and `hook-bridge` were members; nobody published them, so
they left the catalog. The temptation was a looser "plugin" concept with free-form metadata.
Rejected: a registry whose rows do not correspond to a real loading mechanism
would list things that cannot be installed, which is the one failure a registry
must not have.

Concretely, a package that declares no `dsh` manifest is **not indexed**. The
harness activates no layer for such a package — it is a library other plugins
import — so listing it as a plugin would be false.

### 3. The install plan is a domain concept

`buildInstallPlan(artifact, target)` returns machine-executable `steps` *and*
copy-paste `manualCommands`. Three surfaces consume it: the website renders the
commands, the `@dsh-fish/hub` plugin and `@dsh-fish/cli` execute the steps. The first
command is always the hub CLI, so kinds the harness launcher cannot install
still have a copy-pasteable line that does something.

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

When a payload would need a secret, it carries a POSIX environment variable
*name*, never a value. MCP-server rows used to do this; those kinds left the
catalog, so no live payload carries a credential reference. The doctrine still
holds: the registry serves every row publicly without any per-row secrecy
analysis.

### 6. Device grant for harness authentication

A harness on a developer's machine cannot receive an OAuth redirect. Better
Auth's `deviceAuthorization()` plugin implements RFC 8628: the plugin requests a
code, prints it, and polls; the human approves in a browser they already trust.
The approval page must call `GET /api/auth/device?user_code=` while signed in
**before** showing Authorize: that request binds the pending grant to the
session. Skipping it is `DEVICE_CODE_NOT_CLAIMED`.

User codes are generated as 8 digits rather than the default alphanumeric, so the
approval page can use a one-time-code input and a terminal can print something
with no `O`/`0` or `I`/`1` ambiguity to misread.

A device token is deliberately weaker than a session: `requireInteractiveSession`
blocks it from submitting or claiming artifacts. The one write it *may* perform
is rating an artifact (`PUT /api/v1/artifacts/:id/reviews/mine` guards with
`requireActor` instead): a harness agent that just installed something is the
primary source of reviews, and a rating only ever speaks for the account behind
the token — it can neither publish a catalog row nor act as another account.

### 7. Ingestion crawls; submission is a fast path

A cron trigger sweeps the GitHub `dsh-plugin` topic and npm every hour, so
the registry is populated without anyone submitting anything. A signed-in user
may also submit a source; if the GitHub account they signed in with owns the
repository, the row is published immediately, because the row is built by the
same indexer a crawl uses — waiting for review of one's own package would be
friction with no safety benefit. Everything else queues.

Ownership is decided by comparing GitHub's numeric ids — the repository's, from
the API, against the submitter's, from the OAuth link Better Auth recorded in
`accounts`. Not logins: GitHub lets an account rename itself and lets the freed
name be taken by someone else, and a login copied into this hub's tables would
eventually name the wrong person while still carrying publish-without-review
rights. The id is read at submission time rather than cached on the user, so
there is no copy to go stale, and no field on the user that a signed-in account
could set for itself through Better Auth's `update-user` endpoint.

### 8. A row's category is inferred, never demanded

The taxonomy is the hub's, but nothing in the harness reads it, so an author has
no reason to write `dsh.hub.categories` — and almost none do. Categories are
therefore resolved in four steps: a declaration that names real categories wins
outright, otherwise a curated-list label (awesome-dsh-plugin.com first, then
Oh-My-DSH), otherwise they are inferred from the row's own vocabulary (topics,
keywords, description) against a fixed token table, and `other` is the floor.
Purpose ids follow the live awesome-dsh-plugin.com registry, plus `other`;
Oh-My-DSH slugs and this hub's previous ids are aliases, not a second taxonomy.

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
- `@dsh-fish/cli` is a Node binary that executes the same installer the plugin
  uses. It is published separately so `npx @dsh-fish/cli add <id>` works without
  a harness. Command names follow the skills CLI (`add`, `find`, `list`,
  `remove`, `update`, `init`).
- The `@dsh-fish/hub` plugin binds to the harness packages as optional peers and
  develops against them as exact-pinned devDependencies. Host-supplied peers
  (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, and the client packages) stay
  optional because `dsh plugin add` installs into an isolated profile tree that
  never contains the harness copies, so a required peer would print a pnpm
  `WARN` on every successful install.

  The plugin used to declare those shapes locally in
  `packages/dsh-plugin-hub/src/harness.d.ts`, because during the harness's
  developer preview they were not installable standalone from npm. They are
  now published at the same version as the launcher, so the shim is deleted and
  the real declarations are used — which is what makes a drift between our types
  and the harness's a compile error instead of a runtime surprise. DSH 0.2.x
  also made this load-bearing: a bundle whose declared `@deepseek-ai/dsh-*`
  peer requirements the running version does not satisfy is now *skipped at
  boot*, so the peer ranges are an executable compatibility gate rather than
  packaging metadata.

  The same 0.2.x release removed `@deepseek-ai/dsh-client-runtime`. Client-side
  services (`slots`, `locale`) are declared by `dsh-client-ui-renderer`,
  `dsh-client-ui-slots`, `dsh-client-locale` and `dsh-client-ui-settings` as
  module augmentations of cordis's own `Context`, so the browser half imports
  `Context` from `@deepseek-ai/cordis` and lets those packages supply the
  service faces.
- D1 has no cross-statement transactions, so multi-table writes use `db.batch`,
  which D1 applies atomically. Better Auth's drizzle `consumeOne` is a same-table
  `DELETE … IN (SELECT …)` that D1 refuses; the Worker wraps it as find-then-delete
  by id so a device-grant token poll can redeem an approved code.
