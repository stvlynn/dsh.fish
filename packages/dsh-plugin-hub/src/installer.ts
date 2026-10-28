import { execFile } from 'node:child_process'
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
import { isElectronManagedProfile } from './profile.js'
import { dshHome } from './token-store.js'

const defaultRun = promisify(execFile)

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options: { signal: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>

/** What an in-process package operation reported. */
export interface PackageChange {
  /** pnpm's exit status; zero means the profile was changed. */
  readonly exitCode: number
  /** Combined package-manager output, for the step detail. */
  readonly output: string
  /** Why the change waits for a restart, when the host knows. */
  readonly restartReason?: string
}

/**
 * The harness's own package manager, when the host exposes one.
 *
 * A harness process already owns a `PluginManager` service that installs into
 * the profile it booted — the same implementation the Desktop application and
 * the Plugins settings page drive. Reaching it is strictly better than spawning
 * `dsh plugin …`, and not for stylistic reasons:
 *
 * - The launcher refuses `--profile desktop` to any process that is not the
 *   Desktop carrier, so a spawned command cannot manage the profile a Desktop
 *   user is actually looking at. The in-process manager has no such fence.
 * - It installs into the profile *this* process booted, so the target cannot
 *   drift from what the user sees — the failure `resolveProfile` already had to
 *   be taught about.
 *
 * It is optional: a headless or embedded composition may mount no manager, and
 * the launcher path remains the answer there.
 */
export interface PackageManagerPort {
  /** Install one package spec into the running profile. */
  add(spec: string, signal: AbortSignal): Promise<PackageChange>
  /** Remove one installed package from the running profile. */
  remove(name: string, signal: AbortSignal): Promise<PackageChange>
}

export interface InstallerHost {
  readonly home?: string
  readonly run?: CommandRunner
  readonly fetchText?: (url: string, signal: AbortSignal) => Promise<string>
  readonly now?: () => Date
  /** The host's in-process manager, preferred over spawning `dsh`. */
  readonly packages?: PackageManagerPort
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
 * The target profile belongs to the Electron application, which refuses
 * package operations from a terminal. Distinct from a package-manager failure
 * because nothing was attempted and nothing about the plugin is wrong.
 */
export const PROFILE_MANAGED_ELSEWHERE = 'PROFILE_MANAGED_ELSEWHERE'

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

  /**
   * Refuse a profile this process cannot manage.
   *
   * The launcher reserves `desktop` for the Electron carrier: `dsh plugin
   * --profile desktop …` exits non-zero in any other process. That fence applies
   * to the *spawned launcher*, not to the harness itself — the running process
   * owns a `PluginManager` that manages its own profile regardless of which one
   * that is. So this refusal is only correct when the launcher is the transport;
   * a host that supplied an in-process manager has already answered the question.
   *
   * @throws {InstallRefused} with {@link PROFILE_MANAGED_ELSEWHERE}.
   */
  private assertAddressable(): void {
    if (this.host.packages !== undefined) return
    if (!isElectronManagedProfile(this.profile)) return
    throw new InstallRefused(
      `Profile "${this.profile}" can only be managed by the DeepSeek Harness Desktop ` +
        'application itself, and this process has no in-process package manager to do it ' +
        'with. Install this artifact from the Desktop app, or use a harness booted with ' +
        'a profile a terminal launcher owns, such as "web".',
      PROFILE_MANAGED_ELSEWHERE,
    )
  }

  /**
   * Replace this plugin in the running profile with `spec`.
   *
   * `installBundle`/`dsh plugin add` refuse a package whose name is already a
   * profile dependency, without consulting the requested version: DSH 0.2.1
   * raises `already-installed` whenever the name is present and the profile has
   * HMR. That makes an upgrade impossible through the add path alone, which is
   * exactly what this method is for. Removal first clears the name, so the add
   * is an install rather than a conflict.
   *
   * The profile is briefly without the plugin between the two calls. That is
   * unavoidable through this API and is the same window a user gets by removing
   * and re-adding by hand; the alternative — leaving the old version in place —
   * means "check for updates" can never do anything.
   *
   * @param spec - package spec to install.
   * @param signal - cancellation.
   * @returns the applied step, reported as the replacement it is.
   */
  async updateSelf(
    spec = '@dsh-fish/hub',
    signal: AbortSignal = AbortSignal.timeout(5 * 60_000),
  ): Promise<AppliedStep> {
    const name = packageNameFromSpec(spec)
    const installed = await this.dependencyNames()
    if (name !== undefined && installed.has(name)) {
      await this.removePackage(name, signal)
    }
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
    this.assertAddressable()
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
    this.assertAddressable()
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

    if (this.host.packages !== undefined) {
      const change = await this.host.packages.add(spec, signal)
      if (change.exitCode !== 0) {
        throw new InstallRefused(
          `The harness package manager could not install ${spec}: ${
            change.output.trim().slice(0, 1000) || `exit status ${change.exitCode}`
          }`,
          'PACKAGE_INSTALL_FAILED',
        )
      }
      const after = await this.dependencyNames()
      const added = [...after].filter((name) => !before.has(name))
      const name = added[0] ?? packageNameFromSpec(spec) ?? spec
      return {
        step: {
          summary: `Installed ${spec} into the running harness profile`,
          applied: true,
          detail: change.output.trim().slice(0, 2000),
        },
        locked: { spec, name },
      }
    }

    const args = ['plugin', '--profile', this.profile, 'add', spec]
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
    if (this.host.packages !== undefined) {
      const change = await this.host.packages.remove(name, signal)
      if (change.exitCode !== 0) {
        throw new InstallRefused(
          `The harness package manager could not remove ${name}: ${
            change.output.trim().slice(0, 1000) || `exit status ${change.exitCode}`
          }`,
          'PACKAGE_REMOVE_FAILED',
        )
      }
      return {
        summary: `Removed ${name} from the running harness profile`,
        applied: true,
        detail: change.output.trim().slice(0, 2000),
      }
    }

    const args = ['plugin', '--profile', this.profile, 'remove', name]
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
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr: unknown }).stderr).trim()
    if (stderr !== '') return stderr.slice(0, 1000)
  }
  return error instanceof Error ? error.message : String(error)
}
