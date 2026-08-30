import { DomainError } from '../shared/error.js'

/** Where the registry learned about an artifact, and where its code lives. */
export type SourceOrigin = 'npm' | 'github' | 'submission'

export interface NpmSource {
  readonly origin: 'npm'
  /** Full npm package name, scope included, e.g. `@deepseek-ai/dsh-base`. */
  readonly packageName: string
  readonly latestVersion: string
}

export interface VerifiedNpmBinding {
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
  /**
   * The curated lists that surfaced this repository, when discovery did not
   * come from the `dsh-plugin` topic alone. Accumulated across sweeps: a
   * crawl that re-reads the repository refreshes the reference but keeps the
   * provenance earlier crawls recorded.
   */
  readonly via?: readonly string[]
  /**
   * npm package whose packument `repository` is this owner/repo. Recorded at
   * index time so install never guesses from a display name — a legal npm
   * name that is not published, or belongs to someone else, must not become
   * the install spec.
   */
  readonly npm?: VerifiedNpmBinding
  /**
   * Author-supplied GitHub Release `.tgz` bound to this same owner/repo.
   * A prebuilt archive; preferred over a full-repo git checkout, never over
   * a verified npm package.
   */
  readonly releaseTarball?: string
}

export interface SubmissionSource {
  readonly origin: 'submission'
  readonly homepageUrl: string
}

export type SourceRef = NpmSource | GitHubSource | SubmissionSource

const NPM_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/** True when `value` is a legal npm package name (scope optional). */
export function isNpmPackageName(value: string): boolean {
  return NPM_NAME.test(value)
}
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
  via?: readonly string[]
  npm?: VerifiedNpmBinding
  releaseTarball?: string
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
  const npm = input.npm === undefined ? undefined : verifiedNpmBinding(input.npm)
  const releaseTarball =
    input.releaseTarball === undefined
      ? undefined
      : releaseTarballTarget(input.releaseTarball, `${input.owner}/${input.repo}`)
  if (input.releaseTarball !== undefined && releaseTarball === undefined) {
    throw DomainError.invalid('A release tarball must be an HTTPS GitHub Release archive for this repository.', {
      releaseTarball: input.releaseTarball,
      owner: input.owner,
      repo: input.repo,
    })
  }
  return {
    origin: 'github',
    owner: input.owner,
    repo: input.repo,
    ...(input.path === undefined ? {} : { path: input.path.replace(/^\/+|\/+$/g, '') }),
    ...(input.commit === undefined ? {} : { commit: input.commit }),
    ...(input.via === undefined || input.via.length === 0 ? {} : { via: [...new Set(input.via)] }),
    ...(npm === undefined ? {} : { npm }),
    ...(releaseTarball === undefined ? {} : { releaseTarball }),
  }
}

function verifiedNpmBinding(input: VerifiedNpmBinding): VerifiedNpmBinding {
  if (!NPM_NAME.test(input.packageName)) {
    throw DomainError.invalid('Not a valid npm package name.', { packageName: input.packageName })
  }
  if (input.latestVersion.trim() === '') {
    throw DomainError.invalid('A verified npm binding needs a version.', {
      packageName: input.packageName,
    })
  }
  return { packageName: input.packageName, latestVersion: input.latestVersion.trim() }
}

/**
 * A curated, prebuilt GitHub Release archive accepted as a pnpm target —
 * but only one belonging to `repo`, the entry's own `owner/name`.
 *
 * The binding is the whole point. Verified npm gets the same treatment
 * (name-squatting protection); without it here, an entry could name a
 * trusted repo and install an archive from somewhere else. Release CDNs
 * (`objects.githubusercontent.com`, `release-assets.githubusercontent.com`)
 * are not accepted: their paths carry no owner or repo.
 */
export function releaseTarballTarget(value: string, repo: string): string | undefined {
  const target = value.trim()
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined
  if (!url.pathname.endsWith('.tgz') && !url.pathname.endsWith('.tar.gz')) return undefined
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  if (segments.length < 4 || segments[2] !== 'releases') return undefined
  const owner = segments[0]
  const name = segments[1]
  if (owner === undefined || name === undefined) return undefined
  return `${owner}/${name}`.toLowerCase() === repo.toLowerCase() ? target : undefined
}

/**
 * Keep the provenance a refresh would otherwise drop.
 *
 * A sweep rewrites the whole source reference from what it just read, so a
 * repository the topic crawl re-reads after a curated list surfaced it would
 * silently lose the list's `via`. Provenance is accumulated instead: the new
 * reference wins on every field, and the two `via` sets merge. Non-GitHub
 * sources carry no provenance and pass through unchanged.
 */
export function mergeProvenance(existing: SourceRef, next: SourceRef): SourceRef {
  if (existing.origin !== 'github' || next.origin !== 'github') return next
  const via = [...new Set([...(existing.via ?? []), ...(next.via ?? [])])]
  const npm = next.npm ?? existing.npm
  const releaseTarball = next.releaseTarball ?? existing.releaseTarball
  return {
    ...next,
    ...(via.length === 0 ? {} : { via }),
    ...(npm === undefined ? {} : { npm }),
    ...(releaseTarball === undefined ? {} : { releaseTarball }),
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
 * The exact commit the indexer scanned, as a browsable page. Undefined when
 * the source has no pinned commit — npm and submission sources never do.
 */
export function sourceCommitUrl(source: SourceRef): string | undefined {
  return source.origin === 'github' && source.commit !== undefined
    ? `https://github.com/${source.owner}/${source.repo}/commit/${source.commit}`
    : undefined
}

/**
 * Bases a README's *relative* paths resolve against.
 *
 * A readme is read out of a repository, so `[guide](docs/guide.md)` and
 * `![shot](docs/hero.png)` are relative to where it was read from, not to this
 * site. Documents resolve to a browsable page; assets have to resolve to raw
 * bytes, because an HTML page is not an image. Both end in a slash — without
 * one, `new URL('a.png', '…/HEAD/pkg')` drops the last segment.
 *
 * npm and submission sources return undefined. A packument readme carries no
 * knowable root, and rendering a relative path there as an unresolvable path is
 * honest, where guessing one would produce confident 404s.
 */
export function sourceDocBase(source: SourceRef): string | undefined {
  return source.origin === 'github' ? `${githubTree(source, 'blob')}/` : undefined
}

export function sourceAssetBase(source: SourceRef): string | undefined {
  return source.origin === 'github' ? `${githubTree(source, 'raw')}/` : undefined
}

function githubTree(source: GitHubSource, view: 'blob' | 'raw'): string {
  const root = `https://github.com/${source.owner}/${source.repo}/${view}/${source.commit ?? 'HEAD'}`
  return source.path === undefined ? root : `${root}/${source.path}`
}

/**
 * The package-manager specifier `dsh plugin add` receives.
 *
 * Chosen at catalog time, same priority as dshmarket: a repo-verified npm
 * name, then an author-supplied Release tarball bound to the same repository,
 * then a git spec. Git installs are pinned to a commit whenever the registry
 * knows one: an unpinned `github:owner/repo` lets a later push silently change
 * what runs on the user's machine at install time. There is no install-time
 * fallback from a 404'd npm name onto git — that leaves a ghost dependency
 * that bricks later adds.
 */
export function installTargetFor(source: SourceRef): string | undefined {
  switch (source.origin) {
    case 'npm':
      return `${source.packageName}@${source.latestVersion}`
    case 'github':
      if (source.npm !== undefined) return source.npm.packageName
      if (source.releaseTarball !== undefined) return source.releaseTarball
      return gitPackageSpec(source)
    case 'submission':
      return undefined
  }
}

export function packageSpec(source: SourceRef): string | undefined {
  return installTargetFor(source)
}

function gitPackageSpec(source: GitHubSource): string {
  const repo = `${source.owner}/${source.repo}`
  const path = source.path
  const commit = source.commit
  if (path !== undefined && commit !== undefined) {
    return `github:${repo}#${commit}&path:/${path}`
  }
  if (path !== undefined) return `github:${repo}#path:/${path}`
  if (commit !== undefined) return `github:${repo}#${commit}`
  return `github:${repo}`
}

/**
 * Pull `owner/repo` out of the shapes npm and git use to name a GitHub remote.
 *
 * Returns undefined rather than throwing: a packument `repository` field is
 * advisory, and a malformed one must not take the whole artifact down.
 */
export function githubRepoFromUrl(raw: string): { owner: string; repo: string } | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (ssh?.[1] !== undefined && ssh[2] !== undefined) {
    return githubOwnerRepo(ssh[1], ssh[2])
  }

  const shorthand = trimmed.match(/^github:([^/]+)\/([^/]+)$/i)
  if (shorthand?.[1] !== undefined && shorthand[2] !== undefined) {
    return githubOwnerRepo(shorthand[1], shorthand[2])
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed.replace(/^git\+/, ''))
  } catch {
    return undefined
  }
  if (!/^(www\.)?github\.com$/i.test(parsed.hostname)) return undefined
  const [owner, repoWithGit] = parsed.pathname.split('/').filter((part) => part !== '')
  if (owner === undefined || repoWithGit === undefined) return undefined
  return githubOwnerRepo(owner, repoWithGit.replace(/\.git$/i, ''))
}

function githubOwnerRepo(owner: string, repo: string): { owner: string; repo: string } | undefined {
  try {
    const source = githubSource({ owner, repo })
    return { owner: source.owner, repo: source.repo }
  } catch {
    return undefined
  }
}
