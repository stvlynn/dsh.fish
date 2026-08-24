# @dsh-fish/hub

Search [dsh.fish](https://dsh.fish) and install any harness artifact from inside
your agent.

## Install

```sh
dsh plugin --profile <profile> add @dsh-fish/hub
```

`<profile>` is whichever profile the harness boots — `web` for the stock
launcher, `local-dsh` for [Local DSH](https://github.com/stvlynn/local-dsh),
whose bundled launcher is the one to run:

```sh
dsh plugin --profile local-dsh add @dsh-fish/hub
```

The published package ships `lib/` already built, so this install runs no build
script and needs no `allowBuilds` entry.

A git install is a development fallback and must name the subdirectory — the
repository root is a private workspace, not this plugin:

```sh
dsh plugin --profile <profile> add github:stvlynn/dsh.fish#path:packages/dsh-plugin-hub
```

That checkout has no `lib/`, so it builds on install: pnpm ≥10 asks you to allow
the build script, which is permission to execute this package's code on your
machine outside the agent's sandbox.

### Migrating from `dsh-hub`

Earlier versions installed from the repository root under the name `dsh-hub`:

```sh
dsh plugin --profile <profile> remove dsh-hub
dsh plugin --profile <profile> add @dsh-fish/hub
```

Installs already recorded in `$DSH_HOME/.dsh-fish-lock.json` survive the rename.

## Tools

| Tool | What it does |
|---|---|
| `hub_search` | Search the registry by text and artifact kind. |
| `hub_show` | One artifact in detail, including exactly what installing it would do. |
| `hub_install` | Apply the install plan on this machine. |
| `hub_list` | Artifacts this machine already installed through the hub. |
| `hub_remove` | Reverse a recorded install (files, patch rows, packages). |
| `hub_update` | Re-apply the current plan for an installed artifact. |
| `hub_account` | Sign in via the OAuth device flow, check status, or sign out. |
| `hub_reviews` | Community ratings: the site's 1–5 scale, average, distribution, comments. |
| `hub_rate` | Rate an installed artifact 1–5 stars, optionally with a public comment. |

## Settings section

In a harness that serves a browser client, this bundle also adds a **dsh.fish**
section to Settings, with Browse, Installed and Account. It is a second surface
over the same installer, not a second installer: the browser half calls
same-origin routes under `/api/dsh-fish`, and those call the very
`PlanInstaller` the tools use, writing the same
`$DSH_HOME/.dsh-fish-lock.json`. So Installed lists exactly what `hub_list`
reports, and an artifact removed there disappears from the tools.

Browse resolves and shows the install plan before anything runs. A package that
would build from source is refused until you press the button that says so —
that build runs the package's own code outside the agent sandbox.

Account signs in with the same device flow: the section shows the user code and
the verification URL as an ordinary external link. The device code and the
resulting token never reach the browser, and a desktop shell can hand that
`https` link to the system browser rather than navigating its own WebView.

A profile that serves no client still loads the tools — the HTTP surface is
registered only when the composition has a web server.

## Ratings and reviews

The site runs a 1–5 star scale (1 = broken or misleading, 5 = excellent) that
the artifact pages render read-only. `hub_reviews` reads it anonymously;
`hub_rate` writes it and needs sign-in. A rating always speaks for the
signed-in account, and rating again overwrites the earlier one.

The tools carry their own rules in their descriptions, which the agent reads:
rate only what this machine actually installed and used, from firsthand
evidence, never fabricate experience, and tell the user when a rating is left.
After an install or usage that clearly worked or failed, the agent is expected
to *offer* a rating — the decision and the stars stay the user's call.

## Signing in

Reading the catalog needs no account. Signing in attributes installs to you and
is required for anything account-shaped later.

`hub_account` with `action: "login"` starts an RFC 8628 device grant: the plugin
requests a code, shows you a URL, and polls until you approve in a browser. The
token is written to `$DSH_HOME/.dsh-fish-token.json` with mode 0600 and is never
logged.

A device token is deliberately weaker than a browser session — it can read the
catalog, resolve install plans and rate artifacts as you, but it cannot submit
or claim artifacts.

## Safety

`hub_install` refuses any plan whose package step needs a build allowance unless
the caller passes `allowBuildScripts: true`. That step runs the package's own
code at install time, outside the agent sandbox, so the agent must not grant it
on your behalf — it has to come back and ask.

File-writing steps are fenced to the resolved `$DSH_HOME`; a plan that tries to
escape it is refused.

Successful installs are recorded in `$DSH_HOME/.dsh-fish-lock.json`, which is
what `hub_list`, `hub_remove` and `hub_update` (and the matching CLI commands)
read. The same lockfile is shared with `@dsh-fish/cli`.

## Configuration

```yaml
- id: hub
  name: '@dsh-fish/hub'
  config:
    baseUrl: https://dsh.fish   # a self-hosted deployment only changes this
    targetProfile: current      # $DSH_PROFILE, else --profile, else web
```

## License

MIT
