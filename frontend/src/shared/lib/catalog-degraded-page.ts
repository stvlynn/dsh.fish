/**
 * A catalog listing that could not be read.
 *
 * D1 is single-threaded: roughly 1,000 queries/second at 1 ms each, but only
 * about 10/second at 100 ms each. A listing reads tens of thousands of rows, so
 * sustained traffic queues the database until it returns `7429` — and a page
 * whose loader throws renders a 500 for the whole document, including the
 * parts that never needed the catalog.
 *
 * Listing pages are composed of independent rails. When one cannot be read the
 * page still renders, with that rail empty, instead of failing the request.
 */
export interface DegradedPage<T> {
  readonly items: readonly T[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  /**
   * Serialisable failure marker. A `Symbol` would not survive the loader ->
   * component hand-off, so the flag is a plain boolean the route's `headers`
   * export can read to keep the degraded document out of every cache.
   */
  readonly degraded?: true
}

export async function emptyPageOnCatalogFailure<T>(
  limit: number,
  offset: number,
  load: () => Promise<DegradedPage<T>>,
): Promise<DegradedPage<T>> {
  try {
    return await load()
  } catch (error) {
    console.error('catalog_listing_unavailable', {
      message: error instanceof Error ? error.message : String(error),
    })
    return { items: [], total: 0, limit, offset, degraded: true }
  }
}
