# dsh-hub

Search [dsh.fish](https://dsh.fish) and install any harness artifact from inside
your agent.

## Install

```sh
dsh plugin --profile web add github:stvlynn/dsh.fish#path:packages/dsh-plugin-hub
```

The bundle lives in `packages/dsh-plugin-hub`. Installing the repository root
(`github:stvlynn/dsh.fish#main`) pulls the website package, which is not a
harness bundle and will not load.

A GitHub topic crawl only reads the repository root `package.json`, so this
bundle is not discovered automatically. Submit it as
`github:stvlynn/dsh.fish/packages/dsh-plugin-hub` (or the same path on npm
later) for it to appear in the catalog.

This package is TypeScript, so a git install runs its `prepare` script to build
`lib/`. pnpm ≥10 refuses that until you allow it — copy the package key pnpm
prints into your profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-hub: true
```

Then re-run the `add`. That allowance is permission to execute this package's
code on your machine at install time, outside the agent's sandbox — pin a commit
so a later push cannot change what runs.

## Tools

| Tool | What it does |
|---|---|
| `hub_search` | Search the registry by text and artifact kind. |
| `hub_show` | One artifact in detail, including exactly what installing it would do. |
| `hub_install` | Apply the install plan on this machine. |
| `hub_account` | Sign in via the OAuth device flow, check status, or sign out. |

## Signing in

Reading the catalog needs no account. Signing in attributes installs to you and
is required for anything account-shaped later.

`hub_account` with `action: "login"` starts an RFC 8628 device grant. The first
call returns a short code and a URL — show those to the user. The second call
polls until they approve in a browser. The token is written to
`$DSH_HOME/.dsh-fish-token.json` with mode 0600 and is never logged.

A device token is deliberately weaker than a browser session — it can read the
catalog and resolve install plans as you, but it cannot submit or claim
artifacts.

## Safety

`hub_install` refuses any plan whose package step needs a build allowance unless
the caller passes `allowBuildScripts: true`. That step runs the package's own
code at install time, outside the agent sandbox, so the agent must not grant it
on your behalf — it has to come back and ask.

File-writing steps are fenced to the resolved `$DSH_HOME`; a plan that tries to
escape it is refused.

## Configuration

```yaml
- id: hub
  name: dsh-hub
  config:
    baseUrl: https://dsh.fish   # a self-hosted deployment only changes this
    targetProfile: current      # or a specific profile name
```

## License

MIT
