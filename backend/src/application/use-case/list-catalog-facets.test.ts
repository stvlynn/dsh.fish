import { describe, expect, it } from 'vitest'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import type { CatalogFacetCache } from '../port/catalog-facet-cache.js'
import type { FacetsDto } from './list-catalog-facets.js'
import { ListCatalogFacets } from './list-catalog-facets.js'

function countingRepository() {
  const state = { kindReads: 0 }
  const repository = {
    countByKind: async () => {
      state.kindReads += 1
      return [{ kind: 'skill' as const, count: 4 }]
    },
    countByCategory: async () => [{ id: 'dev', count: 2 }],
    countByTopic: async () => [{ id: 'git', count: 1 }],
  } as Pick<ArtifactRepository, 'countByKind' | 'countByCategory' | 'countByTopic'>
  return { repository: repository as ArtifactRepository, state }
}

function memoryCache() {
  const state: { value: FacetsDto | undefined } = { value: undefined }
  const cache: CatalogFacetCache = {
    read: async () => state.value,
    write: async (facets) => {
      state.value = facets
    },
  }
  return { cache, state }
}

describe('ListCatalogFacets', () => {
  it('loads from the catalog on a cache miss and serves the next call from cache', async () => {
    const { repository, state } = countingRepository()
    const { cache } = memoryCache()
    const useCase = new ListCatalogFacets(repository, cache)

    const first = await useCase.execute()
    const second = await useCase.execute()

    expect(state.kindReads).toBe(1)
    expect(first).toBe(second)
    expect(first.kinds.find((entry) => entry.kind === 'skill')?.count).toBe(4)
    expect(first.categories.find((entry) => entry.id === 'dev')?.count).toBe(2)
  })

  it('still queries D1 when no cache is configured', async () => {
    const { repository, state } = countingRepository()
    const useCase = new ListCatalogFacets(repository)

    await useCase.execute()
    await useCase.execute()

    expect(state.kindReads).toBe(2)
  })
})
