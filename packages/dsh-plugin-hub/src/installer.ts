import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { HubClient, InstallPlan, InstallStep } from './hub-client.js'
import {
  listLocked,
  readLock,
  removeLocked,
  upsertLocked,
  type LockedArtifact,
  type LockedPackage,
} from './lockfile.js'
import { dshHome } from './token-store.js'

const defaultRun = promisify(execFile)

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options: { signal: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>

export interface InstallerHost {
  readonly home?: string
  readonly run?: CommandRunner
  readonly fetchText?: (url: string, signal: AbortSignal) => Promise<string>
  readonly now?: () => Date
}

export interface AppliedStep {
  readonly summary: string
  readonly applied: boolean
  readonly detail?: string
}

export interface InstallOutcome {
  readonly artifactId: string
  readonly steps: readonly AppliedStep[]
  readonly credentialsNeeded: readonly string[]
  readonly restartRequired: boolean
}

export interface RemoveOutcome {
  readonly artifactId: string
  readonly steps: readonly AppliedStep[]
  readonly restartRequired: boolean
}

export class InstallRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'InstallRefused'
  }
}

/**
 * Executes an install plan on this machine.
 *
 * The plan is authored by the hub's domain layer, but every decision about
 * *whether* to run a step is made here, on the machine that bears the
 * consequences. In particular, a plan carrying a build allowance is refused
 * unless the caller passed explicit confirmation: pnpm running a package's
 * `prepare` script is arbitrary code execution at install time, outside
 * whatever sandbox the agent itself runs under, and an agent must not grant
 * that silently on a user's behalf.
 *
 * Successful applies are recorded in `$DSH_HOME/.dsh-fish-lock.json` so list,
 * remove and update can reverse or refresh what was written — the plan itself
 * only knows how to add.
 */
export class PlanInstaller {
  constructor(
    private readonly client: HubClient,
    private readonly profile: string,
    private readonly host: InstallerHost = {},
  ) {}

  async updateSelf(
    spec = '@dsh-fish/hub',
    signal: AbortSignal = AbortSignal.timeout(5 * 60_000),
  ): Promise<AppliedStep> {
    const result = await this.addPackage({ type: 'add-package', spec }, signal)
    return result.step
  }

  async apply(
    plan: InstallPlan,
    options: {
      allowBuildScripts: boolean
      signal: AbortSignal
      /** Replace existing patch rows instead of leaving them. Used by update. */
      replaceExisting?: boolean
    },
  ): Promise<InstallOutcome> {
    const needsBuild = plan.steps.some(
      (step) => step.type === 'add-package' && step['requiresBuildAllowance'] === true,
    )
    if (needsBuild && !options.allowBuildScripts) {
      throw new InstallRefused(
        'This artifact builds from source at install time, which runs its code on this machine outside the agent sandbox. ' +
          'Re-run with allowBuildScripts: true only if the user has seen the source and agreed.',
        'BUILD_ALLOWANCE_REQUIRED',
      )
    }

    const applied: AppliedStep[] = []
    const credentials: string[] = []
    const files: string[] = []
    const rows: string[] = []
    const packages: LockedPackage[] = []

    for (const step of plan.steps) {
      switch (step.type) {
        case 'add-package': {
          const result = await this.addPackage(step, options.signal)
          applied.push(result.step)
          if (result.locked) packages.push(result.locked)
          break
        }
        case 'write-file': {
          const result = await this.writePlanFile(step, options.signal)
          applied.push(result.step)
          files.push(result.relativeToHome)
          break
        }
      }
    }

    await upsertLocked(
      {
        artifactId: plan.artifactId,
        kind: plan.kind,
        profile: this.profile,
        installedAt: (this.host.now?.() ?? new Date()).toISOString(),
        files,
        rows,
        packages,
      },
      this.home(),
    )

    return {
      artifactId: plan.artifactId,
      steps: applied,
      credentialsNeeded: credentials,
      // Every path here changes the composed config, which is read at boot.
      restartRequired: applied.some((step) => step.applied),
    }
  }

  async list(): Promise<readonly LockedArtifact[]> {
    return listLocked(await readLock(this.home()), this.profile)
  }

  async remove(
    artifactId: string,
    options: { signal: AbortSignal },
  ): Promise<RemoveOutcome> {
    const existing = await removeLocked(this.profile, artifactId, this.home())
    if (existing === undefined) {
      throw new InstallRefused(
        `Nothing installed as ${artifactId} in profile ${this.profile}.`,
        'NOT_INSTALLED',
      )
    }

    const applied: AppliedStep[] = []

    for (const pkg of existing.packages) {
      applied.push(await this.removePackage(pkg.name, options.signal))
    }

    for (const rowId of existing.rows) {
      applied.push(await this.removePatchRow(rowId))
    }

    for (const relativePath of existing.files) {
      applied.push(await this.removeFile(relativePath))
    }

    return {
      artifactId,
      steps: applied,
      restartRequired: applied.some((step) => step.applied),
    }
  }

  private async addPackage(
    step: InstallStep,
    signal: AbortSignal,
  ): Promise<{ step: AppliedStep; locked: LockedPackage }> {
    const spec = String(step['spec'])
    const before = await this.dependencyNames()
    const args = pluginMutationArgs(this.profile, 'add', spec, this.profileDir())
    try {
      const { stdout, stderr } = await this.run('dsh', args, signal)
      const after = await this.dependencyNames()
      const added = [...after].filter((name) => !before.has(name))
      const name = added[0] ?? packageNameFromSpec(spec) ?? spec
      return {
        step: {
          summary: `dsh ${args.join(' ')}`,
          applied: true,
          detail: (stdout || stderr).trim().slice(0, 2000),
        },
        locked: { spec, name },
      }
    } catch (error) {
      // Surfacing the real command is the useful failure: the user can run it
      // themselves and see exactly what the package manager objected to.
      throw new InstallRefused(
        `\`dsh ${args.join(' ')}\` failed: ${describeRun(error)}`,
        'PACKAGE_INSTALL_FAILED',
      )
    }
  }

  private async removePackage(name: string, signal: AbortSignal): Promise<AppliedStep> {
    const args = pluginMutationArgs(this.profile, 'remove', name, this.profileDir())
    try {
      const { stdout, stderr } = await this.run('dsh', args, signal)
      return {
        summary: `dsh ${args.join(' ')}`,
        applied: true,
        detail: (stdout || stderr).trim().slice(0, 2000),
      }
    } catch (error) {
      throw new InstallRefused(
        `\`dsh ${args.join(' ')}\` failed: ${describeRun(error)}`,
        'PACKAGE_REMOVE_FAILED',
      )
    }
  }

  private async writePlanFile(
    step: InstallStep,
    signal: AbortSignal,
  ): Promise<{ step: AppliedStep; relativeToHome: string }> {
    const relativePath = String(step['relativePath'])
    const root = step['root'] === 'profile' ? this.profileDir() : this.home()
    const target = safeJoin(root, relativePath)

    const fetchText = this.host.fetchText ?? ((url, abort) => this.client.fetchText(url, abort))
    const contents = await fetchText(String(step['downloadUrl']), signal)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')

    return {
      step: { summary: `Wrote ${relativePath}`, applied: true },
      relativeToHome: toPosix(relative(this.home(), target)),
    }
  }

  private async removeFile(relativePath: string): Promise<AppliedStep> {
    const target = safeJoin(this.home(), relativePath)
    await rm(target, { force: true })
    return { summary: `Removed ${relativePath}`, applied: true }
  }

  private async removePatchRow(rowId: string): Promise<AppliedStep> {
    const patchPath = join(this.profileDir(), 'cordis.patch.yml')
    const existing = await readText(patchPath)
    const marker = `# dsh-hub:${rowId}`
    if (!existing.includes(marker)) {
      return { summary: `Row ${rowId} already absent`, applied: false }
    }
    const next = stripMarkedBlock(existing, marker)
    await writeFile(patchPath, next === '' ? '' : `${next}\n`, 'utf8')
    return { summary: `Removed row ${rowId} from the profile patch`, applied: true }
  }

  private async dependencyNames(): Promise<Set<string>> {
    try {
      const raw = await readFile(join(this.profileDir(), 'package.json'), 'utf8')
      const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> }
      return new Set(Object.keys(parsed.dependencies ?? {}))
    } catch {
      return new Set()
    }
  }

  private async run(
    file: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    if (this.host.run) return this.host.run(file, args, { signal })
    return defaultRun(file, [...args], {
      signal,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    })
  }

  private home(): string {
    return this.host.home ?? dshHome()
  }

  private profileDir(): string {
    return join(this.home(), 'profiles', this.profile)
  }
}

/** Refuse a path that escapes its root — a plan is remote input. */
export function safeJoin(root: string, relativePath: string): string {
  const target = resolve(root, normalize(relativePath))
  const fenced = resolve(root)
  if (target !== fenced && !target.startsWith(`${fenced}${sep}`)) {
    throw new InstallRefused(
      `Refusing to write outside ${fenced}: ${relativePath}`,
      'PATH_ESCAPE',
    )
  }
  return target
}

/**
 * Argv for `dsh plugin add|remove`, matching the command the official market
 * actually runs.
 *
 * `dsh plugin add` forwards leftover flags to `pnpm add`. Two of those are
 * load-bearing on a desktop profile:
 *
 * - `-w` (`--workspace-root`): pnpm 9 refuses `add` at a workspace root
 *   without it (`ERR_PNPM_ADDING_TO_ROOT`). Every pnpm major refuses `-w`
 *   when the directory is *not* a workspace, so the flag is injected only
 *   when `pnpm-workspace.yaml` is present.
 * - `--reporter=ndjson` on add: pnpm's real error lands on this stream, not
 *   in `dsh`'s wrapper stderr. Without it, a failed install looks silent.
 */
export function pluginMutationArgs(
  profile: string,
  action: 'add' | 'remove',
  spec: string,
  profileDir: string,
): string[] {
  const args = ['plugin', '--profile', profile, action]
  if (existsSync(join(profileDir, 'pnpm-workspace.yaml'))) {
    args.push('-w')
  }
  args.push(spec)
  if (action === 'add') {
    args.push('--reporter=ndjson')
  }
  return args
}

/**
 * Best-effort package name from a specifier, used when the profile manifest
 * did not gain a new dependency key (re-install of something already present).
 */
export function packageNameFromSpec(spec: string): string | undefined {
  if (spec.startsWith('github:')) {
    const repo = spec.slice('github:'.length).split('#')[0]?.split('/')[1]
    return repo === undefined || repo === '' ? undefined : repo
  }
  if (spec.startsWith('@')) {
    const rest = spec.slice(1)
    const cut = rest.lastIndexOf('@')
    return cut <= 0 ? spec : `@${rest.slice(0, cut)}`
  }
  const cut = spec.lastIndexOf('@')
  return cut <= 0 ? spec : spec.slice(0, cut)
}

function stripMarkedBlock(existing: string, marker: string): string {
  const lines = existing.split('\n')
  const start = lines.findIndex((line) => line.trim() === marker)
  if (start < 0) return existing.trimEnd()
  let end = start + 1
  while (end < lines.length && !lines[end]!.startsWith('# dsh-hub:')) {
    end += 1
  }
  const from = start > 0 && lines[start - 1] === '' ? start - 1 : start
  lines.splice(from, end - from)
  return lines.join('\n').trimEnd()
}


function toPosix(path: string): string {
  return path.split(sep).join('/')
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Explain a failed launcher invocation.
 *
 * `dsh` is resolved through `PATH` and nowhere else — a desktop harness ships
 * its own launcher under a versioned runtime directory, so a hardcoded
 * `/usr/local/bin/dsh` would run a different version than the one that booted
 * this profile. When the lookup fails, the searched `PATH` is the whole
 * diagnosis, so it travels with the error.
 */
function describeRun(error: unknown): string {
  if (isNotFound(error)) {
    return `\`dsh\` is not on PATH. Searched: ${process.env['PATH'] ?? '(PATH unset)'}`
  }
  return describe(error)
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return (error as { code: unknown }).code === 'ENOENT'
}

function describe(error: unknown): string {
  const stdout = field(error, 'stdout')
  const stderr = field(error, 'stderr')
  const fromNdjson = ndjsonError(stdout)
  if (fromNdjson !== undefined) return fromNdjson
  if (stderr !== '') return stderr.slice(0, 2000)
  if (stdout !== '') return stdout.slice(0, 2000)
  return error instanceof Error ? error.message : String(error)
}

function field(error: unknown, name: 'stdout' | 'stderr'): string {
  if (!error || typeof error !== 'object' || !(name in error)) return ''
  return String((error as Record<string, unknown>)[name]).trim()
}

/**
 * pnpm's ndjson reporter writes one JSON object per tick. Progress lines are
 * noise; a line that carries `err` or a `ERR_PNPM_*` message is the actual
 * failure. Walk from the tail so the last diagnostic wins.
 */
export function ndjsonError(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed) as { err?: unknown; message?: unknown }
      if (typeof parsed.message !== 'string' || parsed.message === '') continue
      if (parsed.err !== undefined || /ERR_PNPM_/.test(parsed.message)) {
        return parsed.message.slice(0, 2000)
      }
    } catch {
      // Not a JSON tick; keep scanning.
    }
  }
  return undefined
}
