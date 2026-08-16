import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { HubClient, InstallPlan, InstallStep } from './hub-client.js'
import { dshHome } from './token-store.js'

const run = promisify(execFile)

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
 */
export class PlanInstaller {
  constructor(
    private readonly client: HubClient,
    private readonly profile: string,
  ) {}

  async apply(
    plan: InstallPlan,
    options: { allowBuildScripts: boolean; signal: AbortSignal },
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

    for (const step of plan.steps) {
      switch (step.type) {
        case 'add-package':
          applied.push(await this.addPackage(step, options.signal))
          break
        case 'write-file':
          applied.push(await this.writePlanFile(step, options.signal))
          break
        case 'patch-row':
          applied.push(await this.patchRow(step))
          break
        case 'require-credential': {
          const envName = String(step['envName'])
          credentials.push(envName)
          applied.push({
            summary: `Needs credential ${envName}`,
            applied: false,
            detail: 'Set this before the artifact will connect.',
          })
          break
        }
      }
    }

    return {
      artifactId: plan.artifactId,
      steps: applied,
      credentialsNeeded: credentials,
      // Every path here changes the composed config, which is read at boot.
      restartRequired: applied.some((step) => step.applied),
    }
  }

  private async addPackage(step: InstallStep, signal: AbortSignal): Promise<AppliedStep> {
    const spec = String(step['spec'])
    const args = ['plugin', '--profile', this.profile, 'add', spec]
    try {
      const { stdout, stderr } = await run('dsh', args, {
        signal,
        maxBuffer: 4 * 1024 * 1024,
      })
      return {
        summary: `dsh ${args.join(' ')}`,
        applied: true,
        detail: (stdout || stderr).trim().slice(0, 2000),
      }
    } catch (error) {
      // Surfacing the real command is the useful failure: the user can run it
      // themselves and see exactly what the package manager objected to.
      throw new InstallRefused(
        `\`dsh ${args.join(' ')}\` failed: ${describe(error)}`,
        'PACKAGE_INSTALL_FAILED',
      )
    }
  }

  private async writePlanFile(step: InstallStep, signal: AbortSignal): Promise<AppliedStep> {
    const relativePath = String(step['relativePath'])
    const root = step['root'] === 'profile' ? this.profileDir() : dshHome()
    const target = safeJoin(root, relativePath)

    const contents = await this.client.fetchText(String(step['downloadUrl']), signal)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')

    return { summary: `Wrote ${relativePath}`, applied: true }
  }

  /**
   * Append or replace one row in the profile's own patch layer.
   *
   * Writing to the *profile's* `cordis.patch.yml` rather than a bundle's is
   * deliberate: it is the layer the user owns, applied after every bundle, so
   * a harness upgrade cannot clobber it and the user can edit or delete the row
   * by hand afterwards.
   */
  private async patchRow(step: InstallStep): Promise<AppliedStep> {
    const rowId = String(step['rowId'])
    const rowYaml = String(step['rowYaml'])
    const patchPath = join(this.profileDir(), 'cordis.patch.yml')

    let existing = ''
    try {
      existing = await readFile(patchPath, 'utf8')
    } catch {
      existing = ''
    }

    const marker = `# dsh-hub:${rowId}`
    if (existing.includes(marker)) {
      return {
        summary: `Row ${rowId} already present`,
        applied: false,
        detail: 'Remove the marked block to re-add it.',
      }
    }

    const next = composePatchContents(existing, rowId, rowYaml)

    await mkdir(dirname(patchPath), { recursive: true })
    await writeFile(patchPath, next, 'utf8')

    return { summary: `Added row ${rowId} to the profile patch`, applied: true }
  }

  private profileDir(): string {
    return join(dshHome(), 'profiles', this.profile)
  }
}

/**
 * Append one hub-owned insert to a profile patch file.
 *
 * A freshly initialized profile writes `[]` as its user layer. That token is
 * an empty YAML array, not a prefix we can append to — concatenating
 * `- insert:` after it is not a valid document, and the harness would drop
 * the layer. Replace the empty array instead.
 */
export function composePatchContents(existing: string, rowId: string, rowYaml: string): string {
  const marker = `# dsh-hub:${rowId}`
  const block = `\n${marker}\n- insert:\n${indent(rowYaml, 4)}\n`
  const trimmed = existing.trim()
  if (trimmed === '' || trimmed === '[]') return block.trimStart()
  return `${existing.trimEnd()}\n${block}`
}

/** Refuse a path that escapes its root — a plan is remote input. */
function safeJoin(root: string, relativePath: string): string {
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

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? line : `${pad}${line}`))
    .join('\n')
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr: unknown }).stderr).trim()
    if (stderr !== '') return stderr.slice(0, 1000)
  }
  return error instanceof Error ? error.message : String(error)
}
