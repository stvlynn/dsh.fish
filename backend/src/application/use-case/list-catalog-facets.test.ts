import { describe, expect, it } from 'vitest'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import { ARTIFACT_KIND_META, ARTIFACT_KINDS } from '../../domain/artifact/artifact-kind.js'
import { CATEGORIES } from '../../domain/artifact/category.js'
import { TOPICS } from '../../domain/artifact/topic.js'
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

describe('ListCatalogFacets when the catalog read fails', () => {
  function failingRepository() {
    const state = { kindReads: 0 }
    const repository = {
      countByKind: async () => {
        state.kindReads += 1
        throw new Error('D1 DB exceeded its CPU time limit and was reset.')
      },
      countByCategory: async () => [],
      countByTopic: async () => [],
    } as Pick<ArtifactRepository, 'countByKind' | 'countByCategory' | 'countByTopic'>
    return { repository: repository as ArtifactRepository, state }
  }

  it('caches the fallback so a failing database is not re-read on every request', async () => {
    const { repository, state } = failingRepository()
    const { cache } = memoryCache()
    const useCase = new ListCatalogFacets(repository, cache)

    const first = await useCase.execute()
    const second = await useCase.execute()

    // Uncached misses in a loop are what turn a brief overload into a
    // self-sustaining one: the second call must not reach D1 again.
    expect(state.kindReads).toBe(1)
    expect(second).toEqual(first)
  })

  it('still lists every kind, category and topic with zeroed counts', async () => {
    const { repository } = failingRepository()
    const { cache } = memoryCache()
    const useCase = new ListCatalogFacets(repository, cache)

    const facets = await useCase.execute()

    expect(facets.kinds).toEqual(
      ARTIFACT_KINDS.map((kind) => ({
        kind,
        labelKey: ARTIFACT_KIND_META[kind].labelKey,
        descriptionKey: ARTIFACT_KIND_META[kind].descriptionKey,
        packageManaged: ARTIFACT_KIND_META[kind].packageManaged,
        count: 0,
      })),
    )
    expect(facets.categories.map((entry) => entry.count)).toEqual(
      CATEGORIES.map(() => 0),
    )
    expect(facets.topics.map((entry) => entry.count)).toEqual(TOPICS.map(() => 0))
  })

  it('propagates the failure when no cache can absorb it', async () => {
    const { repository } = failingRepository()
    const useCase = new ListCatalogFacets(repository)

    await expect(useCase.execute()).rejects.toThrow(/CPU time limit/)
  })
})
