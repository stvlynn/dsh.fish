import { DomainError } from '../shared/error.js'

/** Where the registry learned about an artifact, and where its code lives. */
export type SourceOrigin = 'npm' | 'github' | 'submission'

export interface NpmSource {
  readonly origin: 'npm'
  /** Full npm package name, scope included, e.g. `@deepseek-ai/dsh-base`. */
  readonly packageName: string
  readonly latestVersion: string
}

export interface GitHubSource {
  readonly origin: 'github'
  readonly owner: string
  readonly repo: string
  /** Optional subdirectory when one repository ships several artifacts. */
  readonly path?: string
  /** Pinned commit SHA when known. Installing an unpinned git spec is a supply-chain risk. */
  readonly commit?: string
}

export interface SubmissionSource {
  readonly origin: 'submission'
  readonly homepageUrl: string
}

export type SourceRef = NpmSource | GitHubSource | SubmissionSource

const NPM_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const GH_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/
const COMMIT_SHA = /^[0-9a-f]{7,40}$/

export function npmSource(packageName: string, latestVersion: string): NpmSource {
  if (!NPM_NAME.test(packageName)) {
    throw DomainError.invalid('Not a valid npm package name.', { packageName })
  }
  if (latestVersion.trim() === '') {
    throw DomainError.invalid('An npm source needs a version.', { packageName })
  }
  return { origin: 'npm', packageName, latestVersion: latestVersion.trim() }
}

export function githubSource(input: {
  owner: string
  repo: string
  path?: string
  commit?: string
}): GitHubSource {
  if (!GH_SEGMENT.test(input.owner) || !GH_SEGMENT.test(input.repo)) {
    throw DomainError.invalid('Not a valid GitHub owner/repo.', {
      owner: input.owner,
      repo: input.repo,
    })
  }
  if (input.commit !== undefined && !COMMIT_SHA.test(input.commit)) {
    throw DomainError.invalid('A GitHub commit must be a hex SHA.', { commit: input.commit })
  }
  return {
    origin: 'github',
    owner: input.owner,
    repo: input.repo,
    ...(input.path === undefined ? {} : { path: input.path.replace(/^\/+|\/+$/g, '') }),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
  }
}

export function submissionSource(homepageUrl: string): SubmissionSource {
  let parsed: URL
  try {
    parsed = new URL(homepageUrl)
  } catch {
    throw DomainError.invalid('A submission source needs an absolute URL.', { homepageUrl })
  }
  if (parsed.protocol !== 'https:') {
    throw DomainError.invalid('A submission source must be served over HTTPS.', { homepageUrl })
  }
  return { origin: 'submission', homepageUrl: parsed.toString() }
}

/** Canonical browsable URL for a source, used by the site and by attribution. */
export function sourceUrl(source: SourceRef): string {
  switch (source.origin) {
    case 'npm':
      return `https://www.npmjs.com/package/${source.packageName}`
    case 'github': {
      const base = `https://github.com/${source.owner}/${source.repo}`
      if (source.path === undefined) return base
      return `${base}/tree/${source.commit ?? 'HEAD'}/${source.path}`
    }
    case 'submission':
      return source.homepageUrl
  }
}

/**
 * The package-manager specifier `dsh plugin add` receives.
 *
 * Git installs are pinned to a commit whenever the registry knows one: an
 * unpinned `github:owner/repo` lets a later push silently change what runs on
 * the user's machine at install time.
 */
export function packageSpec(source: SourceRef): string | undefined {
  switch (source.origin) {
    case 'npm':
      return `${source.packageName}@${source.latestVersion}`
    case 'github': {
      const name = `github:${source.owner}/${source.repo}`
      const selectors: string[] = []
      if (source.commit !== undefined) selectors.push(source.commit)
      // pnpm's git protocol: `#<commit>&path:<dir>` selects a workspace
      // package inside the clone. Omitting `path` installs the repository
      // root, which for a monorepo is usually not the bundle.
      if (source.path !== undefined) selectors.push(`path:${source.path}`)
      return selectors.length === 0 ? name : `${name}#${selectors.join('&')}`
    }
    case 'submission':
      return undefined
  }
}
