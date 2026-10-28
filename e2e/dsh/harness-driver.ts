/**
 * Driving the real harness: pack the plugin, install it into a sandbox profile,
 * compose the tree, boot it, and read back what the plugin registered.
 *
 * Every assertion in the suite is built from the products of these functions,
 * so this module deliberately returns *evidence* (parsed profile manifests,
 * composed rows, live `ctx` handles) rather than booleans — a failing test can
 * then say what it actually saw.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { DshRuntime } from './dsh-runtime.ts'

/** What `dsh plugin add` left in one profile. */
export interface ProfileAfterInstall {
  /** `dependencies` from the profile manifest. */
  readonly dependencies: Readonly<Record<string, string>>
  /** `dsh.profile.bundles` from the profile manifest. */
  readonly bundles: readonly string[]
}

/** One composed cordis entry, as the launcher would mount it. */
export interface ComposedEntry {
  readonly id?: string
  readonly name?: string
  readonly config?: Record<string, unknown>
}

/**
 * Run the harness launcher inside a sandbox and return its output.
 *
 * @param runtime - the installation to invoke.
 * @param home - `$DSH_HOME` for the child.
 * @param args - launcher arguments.
 * @returns stdout, stderr and the exit code.
 */
export function runDsh(
  runtime: DshRuntime,
  home: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [runtime.binPath, ...args], {
      cwd: options.cwd ?? home,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...options.env,
        DSH_HOME: home,
        // The ambient profile this process runs under names a different
        // harness home; inheriting it would make the suite assert against the
        // developer's machine instead of the sandbox.
        DSH_PROFILE: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
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

/**
 * Pack the plugin under test into a tarball.
 *
 * Packing (rather than installing the workspace directory) is what proves the
 * published artifact works: `files` in `package.json` decides what a user
 * receives, and a missing `lib/` or `cordis.patch.yml` only shows up here.
 *
 * @param packageDir - absolute path of `packages/dsh-plugin-hub`.
 * @param destination - directory to write the tarball into.
 * @returns the tarball path.
 */
export function packPlugin(packageDir: string, destination: string): string {
  const output = execFileSync('npm', ['pack', '--silent', '--pack-destination', destination], {
    cwd: packageDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  const name = output.split('\n').pop()?.trim()
  if (name === undefined || name === '') {
    throw new Error(`npm pack printed no tarball name for ${packageDir}`)
  }
  return join(destination, name)
}

/** Files the published tarball must carry for the bundle to load. */
export const REQUIRED_TARBALL_ENTRIES = [
  'package/lib/index.js',
  'package/lib/install.js',
  'package/lib/client.js',
  'package/cordis.patch.yml',
  'package/package.json',
] as const

/**
 * List a tarball's entries.
 *
 * @param tarball - absolute path to the `.tgz`.
 * @returns its entry paths, `./` prefixes normalised away.
 */
export function listTarball(tarball: string): readonly string[] {
  return execFileSync('tar', ['tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.replace(/^\.\//, '').trim())
    .filter((line) => line !== '')
}

/** Read one file out of a tarball. */
export function readTarballFile(tarball: string, entry: string): string {
  return execFileSync('tar', ['xzf', tarball, '-O', entry], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

/**
 * Install the packed plugin into a sandbox profile through the launcher.
 *
 * This is the exact command the README tells a user to run, so a failure here
 * is a documentation bug as much as a packaging one.
 *
 * @param runtime - the harness to drive.
 * @param home - sandbox `$DSH_HOME`.
 * @param profile - profile name (`web`).
 * @param tarball - the packed plugin.
 * @returns the launcher result, for the caller to assert on.
 */
export function installPlugin(
  runtime: DshRuntime,
  home: string,
  profile: string,
  tarball: string,
): { stdout: string; stderr: string; status: number } {
  return runDsh(runtime, home, ['plugin', '--profile', profile, 'add', tarball])
}

/** Read a sandbox profile's manifest. */
export function readProfileManifest(home: string, profile: string): ProfileAfterInstall {
  const path = join(home, 'profiles', profile, 'package.json')
  if (!existsSync(path)) {
    throw new Error(`no profile manifest at ${path}`)
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  return {
    dependencies: parsed.dependencies ?? {},
    bundles: parsed.dsh?.profile?.bundles ?? [],
  }
}

/**
 * Load and compose a sandbox profile with the harness's own loader.
 *
 * `loadProfile` is what the launcher itself calls, so this reports the same
 * `skippedBundles` a real boot would — which is how a bad `peerDependencies`
 * range surfaces as a test failure rather than a mystery.
 *
 * @param appBoot - the harness's `@deepseek-ai/dsh-app-boot` module.
 * @param runtime - installation anchor for bundle resolution.
 * @param home - sandbox `$DSH_HOME`.
 * @param profile - profile name.
 * @returns the resolved layers, skipped bundles, and composed entries.
 */
export function composeProfile(
  appBoot: AppBootModule,
  runtime: DshRuntime,
  home: string,
  profile: string,
): {
  readonly loadedBundles: readonly string[]
  readonly skipped: readonly { packageName: string; reason: string }[]
  readonly entries: readonly ComposedEntry[]
} {
  const loaded = appBoot.loadProfile('dsh', profile, join(runtime.packageDir, 'package.json'), home)
  const layers = loaded.layers.map((layer) => layer.patches)
  const entries = appBoot.composeEntries([...layers, loaded.patches]) as ComposedEntry[]
  return {
    loadedBundles: loaded.layers.map((layer) => layer.packageName),
    skipped: loaded.skippedBundles,
    entries,
  }
}

/** The `@deepseek-ai/dsh-app-boot` surface this suite uses. */
export interface AppBootModule {
  loadProfile(
    binName: string,
    name: string,
    installAnchor: string,
    home?: string,
    options?: { userLayer?: boolean },
  ): {
    layers: { packageName: string; patches: unknown[][] }[]
    patches: unknown[][]
    skippedBundles: { packageName: string; reason: string }[]
  }
  composeEntries(layers: readonly unknown[][], warn?: (message: string) => void): unknown[]
  loadLayeredEnv(binName: string, cwd?: string): unknown
}

/** The tool names the hub plugin must contribute. */
export const HUB_TOOLS = [
  'hub_search',
  'hub_show',
  'hub_install',
  'hub_list',
  'hub_remove',
  'hub_update',
  'hub_account',
  'hub_reviews',
  'hub_rate',
] as const

/**
 * Boot a composed sandbox profile in-process and hand back the live context.
 *
 * Uses the harness's own `runProfile` — the same entry point `dsh --profile …`
 * calls — so the tree, the module resolution, and the plugin lifecycle are the
 * real ones. A hand-rolled cordis `Context` would skip exactly the machinery
 * under test.
 *
 * @param profileBoot - the harness's `@deepseek-ai/dsh/profile-boot` module.
 * @param appBoot - the harness's `@deepseek-ai/dsh-app-boot` module.
 * @param home - sandbox `$DSH_HOME`.
 * @param profile - profile name.
 * @param args - the profile app's own arguments (`--no-open --port 0`).
 * @returns the booted context and a shutdown function.
 */
export async function bootProfile(
  profileBoot: ProfileBootModule,
  appBoot: AppBootModule,
  home: string,
  profile: string,
  args: readonly string[],
): Promise<{ ctx: BootedContext; shutdown: () => Promise<void> }> {
  process.env['DSH_HOME'] = home
  // Deliberately left as the ambient value rather than cleared: an inherited
  // `$DSH_PROFILE` is exactly the stale signal that once made a booted `web`
  // profile report `desktop`, so leaving it in place lets the suite assert the
  // plugin ignores it. See `profile.ts` for why argv/environment rank below the
  // host's own `profileContext`.

  const booted = await profileBoot.runProfile({
    environment: appBoot.loadLayeredEnv('dsh', home),
    profile,
    patchFiles: [],
    args: [...args],
  })
  return {
    ctx: booted.ctx as BootedContext,
    shutdown: async () => {
      await booted.shutdown.shutdown(0)
    },
  }
}

/** The `@deepseek-ai/dsh/profile-boot` surface this suite uses. */
export interface ProfileBootModule {
  runProfile(options: {
    environment: unknown
    profile: string
    patchFiles: readonly string[]
    args: readonly string[]
  }): Promise<{ ctx: unknown; shutdown: { shutdown(code: number): Promise<void> } }>
}

/** The parts of a booted cordis context this suite reads. */
export interface BootedContext {
  get(key: string): unknown
}

/** The parts of the harness `tools` service this suite reads. */
export interface ToolRegistry {
  get(name: string): unknown
  schemas(): { name: string }[]
}

/** List the directory entries of a directory, or `[]` when it does not exist. */
export function listDir(path: string): readonly string[] {
  return existsSync(path) ? readdirSync(path) : []
}
