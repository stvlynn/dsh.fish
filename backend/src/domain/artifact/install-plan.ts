import { DomainError } from '../shared/error.js'
import type { Artifact } from './artifact.js'
import type { ArtifactKind } from './artifact-kind.js'
import { installTargetFor } from './source-ref.js'

/**
 * Where an install writes. The hub never learns a machine's real paths: a step
 * names a *root* the client resolves locally (`$DSH_HOME`, or the profile
 * directory under it), plus a path relative to that root.
 */
export type PathRoot = 'dsh-home' | 'profile'

export interface InstallTarget {
  /** Profile name, e.g. `web`. `dsh plugin --profile <name> …` operates on it. */
  readonly profile: string
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9-]*$/

export function installTarget(profile: string): InstallTarget {
  const value = profile.trim().toLowerCase()
  if (!PROFILE_NAME.test(value)) {
    throw DomainError.invalid('A profile name must match [a-z0-9][a-z0-9-]*.', { profile })
  }
  return { profile: value }
}

/** Install a package into the profile by forwarding to the package manager. */
export interface AddPackageStep {
  readonly type: 'add-package'
  readonly profile: string
  readonly spec: string
  /**
   * True when the package is a git spec that must run a build script. pnpm >=10
   * refuses that until the user allowlists it, and doing so is permission to
   * execute the package's code at install time, outside any sandbox.
   */
  readonly requiresBuildAllowance: boolean
}

/** Write a file fetched from the registry into a local root. */
export interface WriteFileStep {
  readonly type: 'write-file'
  readonly root: PathRoot
  readonly relativePath: string
  readonly downloadUrl: string
}

export type InstallStep = AddPackageStep | WriteFileStep

/** npm package name of the hub CLI. `npx` runs its `dsh-fish` bin. */
export const HUB_CLI_PACKAGE = '@dsh-fish/cli'

export function hubCliAddCommand(artifactId: string, profile: string): string {
  return `npx ${HUB_CLI_PACKAGE} add ${artifactId} --profile ${profile}`
}

export interface InstallPlan {
  readonly artifactId: string
  readonly kind: ArtifactKind
  readonly target: InstallTarget
  readonly steps: readonly InstallStep[]
  /**
   * Equivalent shell commands. The first is always `npx @dsh-fish/cli add …`,
   * which applies this plan. Native `dsh plugin add` lines follow for bundles.
   */
  readonly manualCommands: readonly string[]
  /** Things the user should read before running the plan. i18n keys, not prose. */
  readonly warningKeys: readonly string[]
  /**
   * The commit the catalog row was scanned from, when the source is a pinned
   * git repository. Provenance for the install surface: the user can check
   * that what they are about to run is what the registry read.
   */
  readonly scannedAtCommit?: string
}

/**
 * Domain service: turn one catalog row into the concrete steps that install it.
 *
 * This is the single place that knows how each artifact kind reaches a machine.
 * The website renders `manualCommands` from it; the `@dsh-fish/hub` plugin and the
 * `@dsh-fish/cli` binary execute `steps` from it. The first command is always
 * the hub CLI, so a copied line actually installs — kinds that the harness
 * launcher does not cover (skills, presets) used to ship only a comment, which
 * is not a command.
 */
export function buildInstallPlan(artifact: Artifact, target: InstallTarget): InstallPlan {
  const steps: InstallStep[] = []
  const manualCommands: string[] = [hubCliAddCommand(artifact.id, target.profile)]
  const warningKeys: string[] = []
  const payload = artifact.payload

  switch (payload.kind) {
    case 'bundle': {
      const spec = bundleInstallSpec(artifact)
      if (spec === undefined) {
        throw DomainError.unsupported('This bundle has no installable package specifier.', {
          artifactId: artifact.id,
        })
      }
      const gitSpec = spec.startsWith('github:')
      steps.push({
        type: 'add-package',
        profile: target.profile,
        spec,
        requiresBuildAllowance: gitSpec && payload.requiresBuild,
      })
      manualCommands.push(`dsh plugin --profile ${target.profile} add ${spec}`)
      if (gitSpec && payload.requiresBuild) {
        warningKeys.push('install.warning.buildAllowance')
      }
      if (gitSpec && artifact.source.origin === 'github' && artifact.source.commit === undefined) {
        warningKeys.push('install.warning.unpinnedGitSpec')
      }
      break
    }

    case 'profile': {
      // A profile is adopted bundle by bundle: `dsh plugin add` creates the
      // profile on first use with `@deepseek-ai/dsh-base` as its first bundle,
      // then appends each listed bundle in order.
      for (const bundleSpec of payload.bundles) {
        steps.push({
          type: 'add-package',
          profile: target.profile,
          spec: bundleSpec,
          requiresBuildAllowance: bundleSpec.startsWith('github:'),
        })
        manualCommands.push(`dsh plugin --profile ${target.profile} add ${bundleSpec}`)
      }
      warningKeys.push('install.warning.profileOrder')
      break
    }

    case 'skill': {
      // Skills are plain files under a skills root; no package manager involved.
      const base =
        payload.layout === 'directory' ? `skills/${payload.skillName}` : 'skills'
      for (const file of payload.files) {
        steps.push({
          type: 'write-file',
          root: 'dsh-home',
          relativePath:
            payload.layout === 'directory'
              ? `${base}/${file.path}`
              : `${base}/${payload.skillName}.md`,
          downloadUrl: file.downloadUrl,
        })
      }
      break
    }

    case 'agent-preset': {
      steps.push({
        type: 'write-file',
        root: 'dsh-home',
        relativePath: `.agent-presets/${payload.presetId}/agent.cordis.yml`,
        downloadUrl: payload.compositionUrl,
      })
      manualCommands.push(
        `# Copy the composition to $DSH_HOME/.agent-presets/${payload.presetId}/agent.cordis.yml`,
      )
      break
    }
  }

  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    target,
    steps,
    manualCommands,
    warningKeys,
    ...(artifact.sourceCommitSha === undefined
      ? {}
      : { scannedAtCommit: artifact.sourceCommitSha }),
  }
}

/**
 * Specifier `dsh plugin add` should receive for a catalog bundle.
 *
 * The choice is made on the source at index time (verified npm, then a
 * same-repo Release tarball, then a pinned git spec). Display names are not
 * consulted: a legal package.json name that is unpublished, or belongs to
 * another repository, must not become the install spec.
 */
export function bundleInstallSpec(artifact: Artifact): string | undefined {
  return installTargetFor(artifact.source)
}
