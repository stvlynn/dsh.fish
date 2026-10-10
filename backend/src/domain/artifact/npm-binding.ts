import { githubRepoFromUrl, isNpmPackageName } from './source-ref.js'
import type { VerifiedNpmBinding } from './source-ref.js'

/**
 * The fields of an npm packument that prove a package name belongs to a
 * GitHub repository. Everything else on the document is ignored.
 */
export interface PackumentRepositoryHint {
  readonly name?: string
  readonly repository?: { readonly url?: string } | string
  readonly 'dist-tags'?: { readonly latest?: string }
  readonly versions?: Readonly<
    Record<string, { readonly repository?: { readonly url?: string } | string }>
  >
}

/**
 * A published package whose packument `repository` is `owner/repo`.
 *
 * Undefined when the name is unpublished, malformed, or points at a different
 * remote — that last case is name-squatting protection: a legal package.json
 * name is not enough.
 */
export function npmBindingFromPackument(
  packument: PackumentRepositoryHint,
  owner: string,
  repo: string,
): VerifiedNpmBinding | undefined {
  const packageName = packument.name
  const latestVersion = packument['dist-tags']?.latest
  if (packageName === undefined || latestVersion === undefined) return undefined
  if (!isNpmPackageName(packageName) || latestVersion.trim() === '') return undefined

  const version = packument.versions?.[latestVersion]
  const github = githubRepoOf(version?.repository ?? packument.repository)
  if (github === undefined) return undefined
  if (github.owner.toLowerCase() !== owner.toLowerCase()) return undefined
  if (github.repo.toLowerCase() !== repo.toLowerCase()) return undefined
  return { packageName, latestVersion: latestVersion.trim() }
}

function githubRepoOf(
  repository: { readonly url?: string } | string | undefined,
): { owner: string; repo: string } | undefined {
  const url = typeof repository === 'string' ? repository : repository?.url
  return url === undefined ? undefined : githubRepoFromUrl(url)
}
