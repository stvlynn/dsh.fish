import { describe, expect, it } from 'vitest'
import type { FacetsDto } from '../../application/use-case/list-catalog-facets.js'
import {
  CATALOG_FACET_CACHE_KEY,
  CATALOG_FACET_CACHE_TTL_SECONDS,
  KvCatalogFacetCache,
} from './kv-catalog-facet-cache.js'

const facets: FacetsDto = {
  kinds: [
    {
      kind: 'skill',
      labelKey: 'kind.skill.label',
      descriptionKey: 'kind.skill.description',
      packageManaged: true,
      count: 3,
    },
  ],
  categories: [{ id: 'dev', labelKey: 'category.dev', count: 2 }],
  topics: [{ id: 'git', labelKey: 'topic.git', count: 1 }],
}

function memoryKv() {
  const entries = new Map<string, { value: string; expirationTtl?: number }>()
  return {
    entries,
    kv: {
      get: async (key: string, type: 'json') => {
        if (type !== 'json') throw new Error(`unexpected get type ${type}`)
        const entry = entries.get(key)
        return entry === undefined ? null : (JSON.parse(entry.value) as unknown)
      },
      put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
        entries.set(key, { value, expirationTtl: options?.expirationTtl })
      },
    },
  }
}

describe('KvCatalogFacetCache', () => {
  it('returns undefined on a miss and round-trips a well-formed payload', async () => {
    const { kv, entries } = memoryKv()
    const cache = new KvCatalogFacetCache(kv as never)

    expect(await cache.read()).toBeUndefined()
    await cache.write(facets)
    expect(await cache.read()).toEqual(facets)
    expect(entries.get(CATALOG_FACET_CACHE_KEY)?.expirationTtl).toBe(CATALOG_FACET_CACHE_TTL_SECONDS)
  })

  it('rejects a malformed payload instead of serving it', async () => {
    const { kv, entries } = memoryKv()
    entries.set(CATALOG_FACET_CACHE_KEY, { value: '{"kinds":[]}' })
    const cache = new KvCatalogFacetCache(kv as never)

    await expect(cache.read()).rejects.toThrow('malformed payload')
  })
})
