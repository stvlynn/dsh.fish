/**
 * How many values of one facet a single catalog query may combine.
 *
 * Every facet is a repeatable query parameter, so the URL space of the catalog
 * is the product of every subset of 22 categories, 4 kinds and the topic set —
 * millions of query strings over the same few thousand rows. A crawler that
 * follows the filter rail's links walks that space one toggle at a time, and
 * each step is a fresh, uncacheable database query. Production traffic showed
 * exactly that: hundreds of addresses requesting 4–14 categories at once.
 *
 * A person narrows a listing; they do not union a dozen categories. Bounding
 * the combination turns those requests into a refusal that costs nothing, which
 * is what Google's faceted-navigation guidance asks for ("return a 404 for
 * nonsensical filter combinations"). The single-facet listings keep their own
 * canonical paths (`/kind/<kind>`, `/category/<category>`, `/topic/<topic>`),
 * so nothing worth reaching becomes unreachable.
 */

/** Combined values allowed per facet. */
export const FACET_VALUE_LIMITS = Object.freeze({
  categories: 3,
  kinds: 2,
  topics: 2,
} as const)

export type BoundedFacet = keyof typeof FACET_VALUE_LIMITS

export interface FacetSelection {
  readonly categories?: readonly string[]
  readonly kinds?: readonly string[]
  readonly topics?: readonly string[]
}

/**
 * The first facet that combines more distinct values than it may, or undefined
 * when the selection is within bounds.
 *
 * Distinct, because a repeated value narrows nothing: `category=git&category=git`
 * is one category, and refusing it would punish a harmless duplicate rather than
 * the enumeration this guards against.
 */
export function exceededFacet(selection: FacetSelection): BoundedFacet | undefined {
  for (const facet of Object.keys(FACET_VALUE_LIMITS) as BoundedFacet[]) {
    const values = selection[facet]
    if (values === undefined) continue
    const distinct = new Set(values.map((value) => value.trim()).filter((value) => value !== ''))
    if (distinct.size > FACET_VALUE_LIMITS[facet]) return facet
  }
  return undefined
}

/**
 * Whether one more value of `facet` may be added to a selection that already
 * holds `current` distinct values. The filter rail uses this to stop offering a
 * link the server would refuse.
 */
export function canAddFacetValue(facet: BoundedFacet, current: number): boolean {
  return current < FACET_VALUE_LIMITS[facet]
}
