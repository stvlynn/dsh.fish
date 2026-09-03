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
  write(facets: FacetsDto): Promise<void>
}
