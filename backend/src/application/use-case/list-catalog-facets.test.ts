import { describe, expect, it } from 'vitest'
import type { ArtifactRepository, FacetCounts } from '../../domain/artifact/artifact-repository.js'
import { ListCatalogFacets } from './list-catalog-facets.js'
import { RefreshCatalogFacets } from './refresh-catalog-facets.js'

function repositoryWith(counts: FacetCounts | undefined) {
  const state = { reads: 0, refreshes: 0 }
  const repository = {
    readFacetCounts: async () => {
      state.reads += 1
      return counts
    },
    refreshFacetCounts: async () => {
      state.refreshes += 1
    },
  } as Pick<ArtifactRepository, 'readFacetCounts' | 'refreshFacetCounts'>
  return { repository: repository as ArtifactRepository, state }
}

const counts: FacetCounts = {
  kinds: [{ kind: 'skill', count: 4 }],
  categories: [{ id: 'dev', count: 2 }],
  topics: [{ id: 'memory', count: 1 }],
  refreshedAt: new Date(0),
}

describe('ListCatalogFacets', () => {
  it('maps stored counts onto the full taxonomy, listing absent entries at zero', async () => {
    const { repository } = repositoryWith(counts)

    const facets = await new ListCatalogFacets(repository).execute()

    expect(facets.kinds.find((entry) => entry.kind === 'skill')?.count).toBe(4)
    expect(facets.kinds.find((entry) => entry.kind === 'bundle')?.count).toBe(0)
    expect(facets.categories.find((entry) => entry.id === 'dev')?.count).toBe(2)
    expect(facets.categories.find((entry) => entry.id === 'theme')?.count).toBe(0)
    expect(facets.topics.find((entry) => entry.id === 'memory')?.count).toBe(1)
  })

  it('reads the stored counts on every call and never refreshes them', async () => {
    const { repository, state } = repositoryWith(counts)
    const useCase = new ListCatalogFacets(repository)

    await useCase.execute()
    await useCase.execute()

    expect(state.reads).toBe(2)
    expect(state.refreshes).toBe(0)
  })

  it('fails loudly when the counts were never refreshed instead of rendering zeroes', async () => {
    const { repository } = repositoryWith(undefined)

    await expect(new ListCatalogFacets(repository).execute()).rejects.toThrow(/never been refreshed/)
  })
})

describe('RefreshCatalogFacets', () => {
  it('asks the repository to rebuild the stored counts', async () => {
    const { repository, state } = repositoryWith(counts)

    await new RefreshCatalogFacets(repository).execute()

    expect(state.refreshes).toBe(1)
  })
})
