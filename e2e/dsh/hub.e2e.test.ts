/**
 * The DSH plugin/CLI end-to-end suite.
 *
 * These tests answer one question the unit tests cannot: *does the published
 * artifact actually load inside a real DeepSeek Harness?* Every step uses the
 * harness's own code paths — `dsh plugin add` to install, `dsh-app-boot`'s
 * `loadProfile` to compose, `profile-boot`'s `runProfile` to boot — because a
 * double for any of them would assert our assumptions rather than DSH's
 * contract.
 *
 * Run with: `pnpm run test:dsh`
 *
 * The suite needs a real `@deepseek-ai/dsh` installation (see
 * `dsh-runtime.ts` for how one is found) and the network, since installing the
 * plugin's own dependencies goes through pnpm.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveDshRuntime, type DshRuntime } from './dsh-runtime.ts'
import { createDshSandbox, type DshSandbox } from './sandbox.ts'
import {
  HUB_TOOLS,
  REQUIRED_TARBALL_ENTRIES,
  bootProfile,
  composeProfile,
  installPlugin,
  listTarball,
  packPlugin,
  readProfileManifest,
  readTarballFile,
  type AppBootModule,
  type ProfileBootModule,
  type ToolRegistry,
} from './harness-driver.ts'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HUB_PACKAGE = join(REPO_ROOT, 'packages', 'dsh-plugin-hub')
const CLI_PACKAGE = join(REPO_ROOT, 'packages', 'dsh-cli')
const CLI_ENTRY = join(CLI_PACKAGE, 'lib', 'cli.js')
const PROFILE = 'web'

/** Panel key shared by the rail icon and the main-column page. */
const MARKET_PANEL_ID = 'dsh-fish-market'

/**
 * Shared state across the suite.
 *
 * Packing and installing dominate the runtime (pnpm resolves the harness's own
 * dependency graph), so they happen once in `before` and every test reads the
 * same sandbox. A per-test sandbox would multiply a minutes-long suite by the
 * number of assertions.
 */
let runtime: DshRuntime
let sandbox: DshSandbox
let appBoot: AppBootModule
let profileBoot: ProfileBootModule
let tarball: string

before(async () => {
  runtime = resolveDshRuntime()
  sandbox = createDshSandbox('hub')
  appBoot = await loadHarnessModule<AppBootModule>(runtime, '@deepseek-ai/dsh-app-boot')
  profileBoot = await loadHarnessModule<ProfileBootModule>(
    runtime,
    '@deepseek-ai/dsh/profile-boot',
  )

  const dist = join(sandbox.home, 'dist')
  mkdirSync(dist, { recursive: true })
  tarball = packPlugin(HUB_PACKAGE, dist)
})

after(() => {
  sandbox?.dispose()
})

describe('packaged plugin', () => {
  it('ships every file the bundle needs to load', () => {
    const entries = listTarball(tarball)
    for (const required of REQUIRED_TARBALL_ENTRIES) {
      assert.ok(
        entries.includes(required),
        `published tarball is missing ${required}; it carries ${entries.join(', ')}`,
      )
    }
  })

  it('registers its browser half with the client module loader', () => {
    // DSH serves `/plugins/<id>/client.js` and requires that file to register
    // itself through this exact call. An ESM client bundle loads without
    // registering and takes the whole settings UI down with it.
    const client = readTarballFile(tarball, 'package/lib/client.js')
    assert.ok(
      client.startsWith('window.__ModuleLoader__.load({'),
      'lib/client.js must open with window.__ModuleLoader__.load({ ... })',
    )
    assert.ok(
      client.includes('"@dsh-fish/hub"'),
      'the module loader registration must use the @dsh-fish/hub id',
    )
  })

  it('registers both the rail entry and the market page in the browser client', () => {
    // The visible entry points. A bundle that loads but registers into no slot
    // is indistinguishable from one that is not installed, so these strings are
    // the only proof the UI appears at all.
    const client = readTarballFile(tarball, 'package/lib/client.js')
    assert.ok(
      client.includes('sidebar.panellist'),
      'the bundle must register an icon in the left rail',
    )
    assert.ok(
      client.includes(MARKET_PANEL_ID),
      `the bundle must register the ${MARKET_PANEL_ID} page in the main column`,
    )
  })

  it('references no package the harness no longer ships', () => {
    // `@deepseek-ai/dsh-client-runtime` existed up to DSH 0.1.1-rc.2 and was
    // removed in 0.2.x. A stale reference is invisible at build time — the
    // import is type-only and `dsh.client.inject` is informational — and only
    // fails when a user's client bundle loads, so nothing shorter than a
    // manifest-wide check catches it.
    const manifest = readTarballFile(tarball, 'package/package.json')
    assert.ok(
      !manifest.includes('@deepseek-ai/dsh-client-runtime'),
      'the plugin manifest must not name @deepseek-ai/dsh-client-runtime; it does not exist in DSH 0.2.x',
    )
    const built = readTarballFile(tarball, 'package/lib/client.js')
    assert.ok(
      !built.includes('@deepseek-ai/dsh-client-runtime'),
      'the built client bundle must not require @deepseek-ai/dsh-client-runtime',
    )
  })
})

describe('installation into a real harness profile', () => {
  it('installs through the launcher and activates the bundle', () => {
    const result = installPlugin(runtime, sandbox.home, PROFILE, tarball)
    assert.equal(
      result.status,
      0,
      `dsh plugin add failed:\n${result.stdout}\n${result.stderr}`,
    )

    const manifest = readProfileManifest(sandbox.home, PROFILE)
    assert.ok(
      '@dsh-fish/hub' in manifest.dependencies,
      `@dsh-fish/hub is missing from profile dependencies: ${JSON.stringify(manifest.dependencies)}`,
    )
    // DSH 0.2.x reconciles `dsh.profile.bundles` itself after `pnpm add`.
    // On 0.1.x the user had to add the row by hand, so this assertion is what
    // makes the documented one-command install true.
    assert.ok(
      manifest.bundles.includes('@dsh-fish/hub'),
      `the launcher did not select the bundle: ${JSON.stringify(manifest.bundles)}`,
    )
  })

  it('composes the plugin row into the profile tree', () => {
    const composed = composeProfile(appBoot, runtime, sandbox.home, PROFILE)

    // A bundle whose declared DSH requirements the runtime rejects is skipped
    // silently — the tree boots without it and the user sees no hub tools. This
    // is the check that catches a wrong peer/engines range.
    assert.deepEqual(
      composed.skipped,
      [],
      `the harness skipped bundles: ${JSON.stringify(composed.skipped, null, 2)}`,
    )

    const hubRow = composed.entries.find((entry) => entry.name === '@dsh-fish/hub')
    assert.ok(hubRow !== undefined, 'the composed tree carries no @dsh-fish/hub row')
    assert.equal(hubRow.id, 'hub')
    assert.deepEqual(hubRow.config, {
      baseUrl: 'https://dsh.fish',
      targetProfile: 'current',
    })
  })
})

describe('booted harness', () => {
  it('registers every hub tool on the live tool registry', async () => {
    const { ctx, shutdown } = await bootProfile(profileBoot, appBoot, sandbox.home, PROFILE, [
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ])
    try {
      const tools = ctx.get('tools') as ToolRegistry | undefined
      assert.ok(tools !== undefined, 'the booted profile exposes no tools service')

      const missing = HUB_TOOLS.filter((name) => tools.get(name) === undefined)
      assert.deepEqual(
        missing,
        [],
        `the hub plugin registered ${HUB_TOOLS.length - missing.length}/${HUB_TOOLS.length} tools`,
      )
    } finally {
      await shutdown()
    }
  })

  it('serves its settings API from the live web server', async () => {
    const { ctx, shutdown } = await bootProfile(profileBoot, appBoot, sandbox.home, PROFILE, [
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ])
    try {
      const webServer = ctx.get('webServer') as { port: number } | undefined
      assert.ok(webServer !== undefined, 'the booted profile exposes no webServer service')
      const origin = `http://127.0.0.1:${webServer.port}`

      const state = await fetch(`${origin}/api/dsh-fish/state`)
      assert.equal(state.status, 200, 'GET /api/dsh-fish/state did not answer 200')
      const body = (await state.json()) as Record<string, unknown>

      // `profile` is the load-bearing field: it decides which profile an
      // install writes into, so it must name the profile that actually booted.
      // The suite leaves the ambient `$DSH_PROFILE` in place precisely so this
      // assertion covers the regression where a stale value won instead.
      assert.equal(body['profile'], PROFILE)
      assert.equal(body['baseUrl'], 'https://dsh.fish')
      assert.ok(typeof body['version'] === 'string')
      assert.ok(Array.isArray(body['installed']))
      assert.ok(typeof body['account'] === 'object' && body['account'] !== null)

      const unknown = await fetch(`${origin}/api/dsh-fish/not-a-route`)
      assert.equal(unknown.status, 404)
      assert.deepEqual(await unknown.json(), { error: 'not found' })
    } finally {
      await shutdown()
    }
  })
})

describe('CLI against the same sandbox', () => {
  it('builds to a runnable entry point', () => {
    assert.ok(
      existsSync(CLI_ENTRY),
      `${CLI_ENTRY} is missing; run \`pnpm --filter @dsh-fish/cli run build\` first`,
    )
  })

  it('reports its version', () => {
    const result = runCli(sandbox.home, ['--version'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /\d+\.\d+\.\d+/)
  })

  it('lists installed artifacts as JSON for a fresh home', () => {
    const result = runCli(sandbox.home, ['list', '--json'])
    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout) as { profile?: unknown; items?: unknown }
    assert.equal(parsed.profile, PROFILE)
    assert.deepEqual(parsed.items, [], 'a fresh harness home has no hub installs')
  })

  it('refuses the Electron-managed desktop profile', () => {
    // DSH 0.2.x rejects `dsh plugin --profile desktop` outside the Desktop app,
    // so the CLI must say so plainly instead of surfacing a package-manager
    // error. This is the profile an agent shell inside Desktop names by default,
    // which makes the message the first thing such a user sees.
    const result = runCli(sandbox.home, ['add', 'release-notes', '--profile', 'desktop'])
    assert.notEqual(result.status, 0, 'a desktop-profile request must not silently succeed')
    const output = `${result.stdout}${result.stderr}`
    assert.match(output, /desktop/i, 'the failure must name the desktop profile')
    assert.doesNotMatch(
      output,
      /PACKAGE_INSTALL_FAILED|ERR_PNPM/,
      'the desktop refusal must happen before a package manager runs',
    )
  })
})

/** Load one harness package through the installation's own dependency tree. */
async function loadHarnessModule<T>(target: DshRuntime, specifier: string): Promise<T> {
  return (await import(/* @vite-ignore */ target.resolveModule(specifier))) as T
}

/** Invoke the built hub CLI in a sandbox home. */
function runCli(
  home: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI_ENTRY, ...args], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home, DSH_PROFILE: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    return { stdout, stderr: '', status: 0 }
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      status: failure.status ?? 1,
    }
  }
}
