import type { KVNamespace } from '@cloudflare/workers-types'
import type { CatalogFacetCache } from '../../application/port/catalog-facet-cache.js'
import type { FacetsDto } from '../../application/use-case/list-catalog-facets.js'

export const CATALOG_FACET_CACHE_KEY = 'catalog:facets:v1'

/** Cloudflare KV's minimum TTL. Facets are a catalog-wide snapshot, not per-URL. */
export const CATALOG_FACET_CACHE_TTL_SECONDS = 60

export class KvCatalogFacetCache implements CatalogFacetCache {
  constructor(private readonly kv: KVNamespace) {}

  async read(): Promise<FacetsDto | undefined> {
    const value = await this.kv.get(CATALOG_FACET_CACHE_KEY, 'json')
    if (value === null) return undefined
    return asFacetsDto(value)
  }

  async write(facets: FacetsDto): Promise<void> {
    await this.kv.put(CATALOG_FACET_CACHE_KEY, JSON.stringify(facets), {
      expirationTtl: CATALOG_FACET_CACHE_TTL_SECONDS,
    })
  }
}

function asFacetsDto(value: unknown): FacetsDto {
  if (!isFacetsDto(value)) {
    throw new Error('catalog facet cache held a malformed payload')
  }
  return value
}

function isFacetsDto(value: unknown): value is FacetsDto {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.kinds) && Array.isArray(record.categories) && Array.isArray(record.topics)
}
