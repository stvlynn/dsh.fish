import { githubRepoFromUrl } from '../../domain/artifact/source-ref.js'
import { canonicalCategoryId } from '../../domain/artifact/category.js'

/**
 * One row from a curated catalog, before the prober decides whether it is
 * a loadable artifact.
 *
 * `category` is the list's own label. It may be a canonical hub id, an
 * Oh-My-DSH slug, or junk — `canonicalCategoryId` decides which of those
 * the overlay keeps.
 */
export interface ListCandidate {
  readonly url: string
  readonly category?: string
  /** Repo-verified npm package name, when the curated list recorded one. */
  readonly npm?: string
  /** GitHub Release `.tgz` URL, when the curated list recorded one. */
  readonly tarball?: string
}

export function extractAwesomeDshPlugin(body: unknown): readonly ListCandidate[] {
  return candidatesOf(body, 'plugins')
}

export function extractOhMyDsh(body: unknown): readonly ListCandidate[] {
  return candidatesOf(body, 'items')
}

function candidatesOf(body: unknown, key: 'plugins' | 'items'): readonly ListCandidate[] {
  const entries = (body as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    const record = entry as Record<string, unknown> | null
    const url = record?.url
    if (typeof url !== 'string') return []
    const category = record?.category
    const npm = record?.npm
    const tarball = record?.tarball
    return [
      {
        url,
        ...(typeof category === 'string' && category.trim() !== '' ? { category } : {}),
        ...(typeof npm === 'string' && npm.trim() !== '' ? { npm: npm.trim() } : {}),
        ...(typeof tarball === 'string' && tarball.trim() !== '' ? { tarball: tarball.trim() } : {}),
      },
    ]
  })
}

/**
 * owner/repo (lowercased) → canonical category, first list wins.
 *
 * awesome-dsh-plugin.com is the finer vocabulary, so it should be passed
 * first; Oh-My-DSH fills gaps the other list does not name.
 */
export function overlayFromCandidates(
  layers: readonly (readonly ListCandidate[])[],
): ReadonlyMap<string, string> {
  const overlay = new Map<string, string>()
  for (const candidates of layers) {
    for (const candidate of candidates) {
      const repo = githubRepoFromUrl(candidate.url)
      if (repo === undefined || candidate.category === undefined) continue
      const key = `${repo.owner}/${repo.repo}`.toLowerCase()
      if (overlay.has(key)) continue
      const id = canonicalCategoryId(candidate.category)
      if (id === undefined) continue
      overlay.set(key, id)
    }
  }
  return overlay
}
