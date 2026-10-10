import { npmBindingFromPackument } from '../../domain/artifact/npm-binding.js'
import type { VerifiedNpmBinding } from '../../domain/artifact/source-ref.js'

const REGISTRY = 'https://registry.npmjs.org'

/** Look up a published package and bind it to `owner/repo` when the remotes match. */
export type NpmBindingLookup = (
  packageName: string,
  owner: string,
  repo: string,
) => Promise<VerifiedNpmBinding | undefined>

/**
 * Fetch the packument for `packageName` and accept it only when its
 * `repository` is this GitHub remote. A 404 or a mismatched remote is
 * undefined, not an error: the catalog then falls through to a tarball or
 * git spec instead of guessing.
 */
export async function lookupNpmBinding(
  packageName: string,
  owner: string,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedNpmBinding | undefined> {
  try {
    const response = await fetchImpl(
      `${REGISTRY}/${encodeURIComponent(packageName).replace('%40', '@')}`,
      { headers: { accept: 'application/json' } },
    )
    if (!response.ok) return undefined
    return npmBindingFromPackument((await response.json()) as object, owner, repo)
  } catch {
    return undefined
  }
}
