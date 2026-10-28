/**
 * Locating and driving a real DeepSeek Harness installation.
 *
 * The hub plugin and the CLI only mean anything when a real harness boots them:
 * the plugin binds to `ctx.tools` and `ctx.webServer` on the host's own cordis
 * context, and the CLI shells out to the host's `dsh` launcher for every package
 * operation. A test double for either would assert our own assumptions back at
 * us instead of the contract DSH actually enforces.
 *
 * So this module resolves a *real* `@deepseek-ai/dsh` install and boots a real
 * profile from it. Two sources, in order:
 *
 * 1. `DSH_FISH_DSH_PACKAGE` — an explicit path to a `@deepseek-ai/dsh` package
 *    directory. Use this to pin the suite to a specific release.
 * 2. The `dsh` on `PATH` — resolved to its package root. This is the launcher a
 *    user would actually run, so it is the honest default.
 *
 * Nothing here downloads anything: adding a harness to the machine is a user's
 * decision, and a test suite that silently fetches ~800 MB is not.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/** One resolved harness installation and the modules it exposes. */
export interface DshRuntime {
  /** Absolute path of the `@deepseek-ai/dsh` package directory. */
  readonly packageDir: string
  /** Version the installation reports (`dsh --version`). */
  readonly version: string
  /** Absolute path of the launcher entry point (`lib/bin.js`). */
  readonly binPath: string
  /**
   * Resolve a module from this installation's own dependency tree.
   *
   * The harness ships as one package with its dependencies nested beside it, so
   * a module a DSH plugin imports (`@deepseek-ai/dsh-tools`) must be resolved
   * from the launcher, not from this repository — the two are different
   * versions, and resolving ours would test the wrong one.
   */
  resolveModule(specifier: string): string
  /** Read this installation's own `package.json`. */
  manifest(): DshManifest
}

/** The subset of a harness `package.json` this suite reads. */
export interface DshManifest {
  readonly name?: string
  readonly version?: string
}

/** Raised when no usable harness installation can be found. */
export class DshRuntimeMissing extends Error {
  constructor(detail: string) {
    super(
      'A real DeepSeek Harness installation is required for the DSH end-to-end suite. ' +
        `Install @deepseek-ai/dsh (npm i -g @deepseek-ai/dsh) so \`dsh\` is on PATH, or point ` +
        `DSH_FISH_DSH_PACKAGE at a @deepseek-ai/dsh package directory. ${detail}`,
    )
    this.name = 'DshRuntimeMissing'
  }
}

/**
 * Resolve the harness installation this suite should drive.
 *
 * @returns the installation, with module resolution bound to its own tree.
 * @throws {DshRuntimeMissing} when neither an explicit path nor a `dsh` on PATH
 *   yields a readable `@deepseek-ai/dsh` package.
 */
export function resolveDshRuntime(env: NodeJS.ProcessEnv = process.env): DshRuntime {
  const explicit = env['DSH_FISH_DSH_PACKAGE']
  if (explicit !== undefined && explicit.trim() !== '') {
    return fromPackageDir(explicit.trim(), 'DSH_FISH_DSH_PACKAGE')
  }

  const fromPath = findOnPath('dsh', env)
  if (fromPath === undefined) {
    throw new DshRuntimeMissing('No `dsh` executable is on PATH.')
  }

  // The launcher is a symlink into a node_modules tree; the package directory
  // is the one holding the manifest that declares `bin.dsh`.
  const real = realpathSync(fromPath)
  const packageDir = findPackageDir(dirname(real))
  if (packageDir === undefined) {
    throw new DshRuntimeMissing(
      `\`dsh\` resolved to ${real}, but no @deepseek-ai/dsh package.json was found above it.`,
    )
  }
  return fromPackageDir(packageDir, 'the `dsh` on PATH')
}

function fromPackageDir(reportedDir: string, source: string): DshRuntime {
  // Under pnpm (and npm's global prefix) the package directory is often a
  // symlink into a content-addressed store. Module resolution must run from the
  // *real* location: the harness's dependencies sit beside the realpath, not
  // beside the link, so anchoring on the link silently resolves nothing.
  const packageDir = existsSync(reportedDir) ? realpathSync(reportedDir) : reportedDir
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new DshRuntimeMissing(`${source} (${reportedDir}) has no package.json.`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DshManifest & {
    bin?: Record<string, string> | string
  }
  if (manifest.name !== '@deepseek-ai/dsh') {
    throw new DshRuntimeMissing(
      `${source} (${packageDir}) is ${JSON.stringify(manifest.name)}, not @deepseek-ai/dsh.`,
    )
  }

  const binRelative =
    typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['dsh']
  if (binRelative === undefined) {
    throw new DshRuntimeMissing(`${source} (${packageDir}) declares no \`bin.dsh\`.`)
  }
  const binPath = resolve(packageDir, binRelative)
  const anchor = join(packageDir, 'lib', 'bin.js')
  const requireFromHarness = createRequire(existsSync(anchor) ? anchor : manifestPath)

  return {
    packageDir,
    version: manifest.version ?? 'unknown',
    binPath,
    manifest: () => manifest,
    resolveModule(specifier: string): string {
      try {
        return requireFromHarness.resolve(specifier)
      } catch (cause) {
        throw new DshRuntimeMissing(
          `The harness at ${packageDir} cannot resolve ${JSON.stringify(specifier)}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        )
      }
    },
  }
}

/** Walk up from `start` looking for a directory whose package.json names `@deepseek-ai/dsh`. */
function findPackageDir(start: string): string | undefined {
  let current = resolve(start)
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'package.json')
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as DshManifest
        if (parsed.name === '@deepseek-ai/dsh') return current
      } catch {
        // A malformed manifest is not this package; keep walking.
      }
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/** Resolve an executable name through `PATH` without invoking it. */
function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    // `command -v` is the portable lookup: it honours the same PATH rules the
    // installer's `dsh plugin` spawn will, so a pass here means a pass there.
    const found = execFileSync('sh', ['-c', `command -v ${name}`], {
      encoding: 'utf8',
      env: { ...env },
    }).trim()
    return found === '' ? undefined : found
  } catch {
    return undefined
  }
}
