/**
 * Parameters in the order every filter link writes them.
 *
 * Two clicks in a different order used to mint two different URLs for the same
 * selection (`category=a&category=b` and `category=b&category=a`), and the
 * origin cache keys on the URL, so each order paid for its own query. One order,
 * with each repeatable value sorted and de-duplicated, makes equal selections
 * share one cache entry.
 */
const PARAM_ORDER = ['q', 'kind', 'category', 'topic', 'verified', 'sort', 'offset'] as const

/** Keys whose values are a set, so their order and duplicates carry no meaning. */
const SET_PARAMS: ReadonlySet<string> = new Set(['kind', 'category', 'topic'])

/**
 * The `/browse` path with one value of a repeatable filter added or removed.
 * Pagination resets: page five of a different listing is not a place anyone
 * meant to go.
 */
export function toggleFilterPath(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params)
  const existing = next.getAll(key)
  next.delete(key)
  for (const entry of existing) {
    if (entry !== value) next.append(key, entry)
  }
  if (!existing.includes(value)) next.append(key, value)
  next.delete('offset')
  const query = canonicalQuery(next).toString()
  return query === '' ? '/browse' : `/browse?${query}`
}

/** `params` rewritten in `PARAM_ORDER`, sets sorted and de-duplicated, empties dropped. */
export function canonicalQuery(params: URLSearchParams): URLSearchParams {
  const known = new Set<string>(PARAM_ORDER)
  const ordered = new URLSearchParams()
  const keys = [...PARAM_ORDER, ...[...new Set(params.keys())].filter((key) => !known.has(key)).sort()]
  for (const key of keys) {
    const values = params.getAll(key).filter((value) => value.trim() !== '')
    const normalized = SET_PARAMS.has(key) ? [...new Set(values)].sort() : values
    for (const value of normalized) ordered.append(key, value)
  }
  return ordered
}
