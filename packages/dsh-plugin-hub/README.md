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

On DSH 0.2.x that is the whole install: the launcher reconciles
`dsh.profile.bundles` itself after `pnpm add`, so the bundle is selected and
mounts on the next start with no `cordis.patch.yml` edit. (DSH 0.1.x required
the row to be added by hand.)

The published package ships `lib/` already built, so this install runs no build
script and needs no `allowBuilds` entry.

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools` and the client packages are
supplied by the harness at runtime. They are optional peers so pnpm does not
warn when the profile tree cannot see the host copies — a `WARN` about missing
peers is not a failed install.

This plugin targets DSH `0.2.1-rc.2` and later. That is enforced by the
launcher, not merely documented: a bundle whose `@deepseek-ai/dsh-*` peer
requirements the running version does not satisfy is skipped at boot, leaving
no `hub_*` tools behind. `dsh plugin add` reports such a package as
`incompatible` with the exact command that would grant a version exemption.

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

## In the browser client

A harness that serves a browser client gets two ways in, both over the same
installer:

- **A dsh.fish icon in the left rail.** Clicking it swaps the main column to a
  full-width market page with Discover, Installed and Account tabs. This is the
  harness's own navigation pattern — the Plugins and Schedule panels work the
  same way — so the market sits beside them rather than behind a settings
  dialog. The page keeps a visited tab mounted, so a search survives checking
  what is already installed, and offers a way back to the conversation.
- **A dsh.fish section in Settings**, for readers who are already configuring
  the harness.

Neither is a second installer. The browser half calls
same-origin routes under `/api/dsh-fish`, and those call the very
`PlanInstaller` the tools use, writing the same
`$DSH_HOME/.dsh-fish-lock.json`. So Installed lists exactly what `hub_list`
reports, and an artifact removed there disappears from the tools.

Browse cards install in place: the button runs `/install` immediately and
shows a spinner until the lockfile updates. An already-installed artifact
shows Uninstall instead. Catalog search and the README modal send the host
locale so hub i18n matches the harness. Clicking a card opens that README.

Account signs in with the same device flow: the section shows the user code and
the verification URL as an ordinary external link. Once signed in, it shows
the account avatar and a tooltip from `/me`. The device code and the
resulting token never reach the browser, and a desktop shell can hand that
`https` link to the system browser rather than navigating its own WebView.

The heading and the Account tab both offer **Check for updates**. That hits
npm for the latest `@dsh-fish/hub` and, when a newer version exists, runs
`dsh plugin add @dsh-fish/hub` on this profile so the next restart loads it.

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
    targetProfile: current      # the booted profile, else --profile, else $DSH_PROFILE, else web
```

`current` resolves to the profile this harness actually booted: the plugin asks
the host's own `profileContext` service, which the launcher populates with the
name it mounted. An inherited `$DSH_PROFILE` is only a fallback, because the
launcher does not export it into the harness process — it is contributed to
model shell calls instead — so a value in the environment describes some other
shell, not this harness.

`desktop` is the one profile this plugin cannot install into. The launcher
reserves it for the DeepSeek Harness Desktop application, which refuses
`dsh plugin --profile desktop …` from a terminal; `hub_install` answers with
`PROFILE_MANAGED_ELSEWHERE` and names the profile instead of forwarding a
package-manager failure. Install from inside the Desktop app, or target `web`.

## License

MIT
