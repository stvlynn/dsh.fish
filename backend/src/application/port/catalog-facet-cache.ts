import type { FacetsDto } from '../use-case/list-catalog-facets.js'

/**
 * Shared facet counts for home, browse, and `GET /api/v1/facets`.
 *
 * Those counts do not vary with `q` or filter query strings, so unique crawl
 * URLs must not each re-run the three aggregations. Port owned by the
 * application layer; implemented in `infrastructure` over KV.
 */
export interface CatalogFacetCache {
  read(): Promise<FacetsDto | undefined>
  /**
   * `ttlSeconds` overrides the default lifetime. A degraded payload is stored
   * with a longer one: a short TTL on a failing database means every expiry
   * re-runs the aggregation that just failed, which is the overload this port
   * exists to prevent.
   */
  write(facets: FacetsDto, ttlSeconds?: number): Promise<void>
}

/**
 * Lifetime of the degraded payload written after a catalog aggregation fails.
 *
 * Longer than a healthy snapshot deliberately: the point of caching a failure
 * is to stop calling a database that is already refusing work, and a short
 * window would simply retry the failing aggregation on every expiry for as
 * long as the outage lasts. Five minutes bounds the staleness a reader sees
 * while keeping the retry rate low enough for D1 to drain.
 */
export const CATALOG_FACET_FALLBACK_TTL_SECONDS = 300
