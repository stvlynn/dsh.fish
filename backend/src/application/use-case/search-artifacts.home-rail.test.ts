import { describe, expect, it } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactQuery, ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import { page } from '../../domain/shared/pagination.js'
import type { SummaryTranslationRepository } from '../../domain/artifact/summary-translation.js'
import type { PageDto } from '../dto/artifact-dto.js'
import type { ArtifactSummaryDto } from '../dto/artifact-dto.js'
import type { HomeRailCache } from './search-artifacts.js'
import { SearchArtifacts } from './search-artifacts.js'

function emptySummaryTranslations(): SummaryTranslationRepository {
  return { find: async () => undefined, listFor: async () => [], save: async () => {} }
}

function artifact(id: string): Artifact {
  return new Artifact({
    id,
    kind: 'skill',
    displayName: id,
    summary: 'a plugin',
    source: npmSource('example', id),
    payload: { npm: { package: id, version: '1.0.0' } },
    keywords: [],
    categories: [],
    stats: { stars: 0, downloads: 0, installs: 0 },
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  })
}

function listingRepository() {
  const state = { searches: 0 }
  const repository: ArtifactRepository = {
    findById: async () => undefined,
    search: async (query: ArtifactQuery) => {
      state.searches += 1
      return page([artifact('dsh-alpha')], 1, query.page)
    },
    countByKind: async () => [],
    save: async () => {},
    saveMany: async () => {},
    incrementInstalls: async () => {},
    recordMetricsSnapshot: async () => {},
    listIdsByOrigin: async () => [],
    listForSitemap: async () => {
      throw new Error('not used')
    },
    listForSnapshot: async () => {
      throw new Error('not used')
    },
    catalogStats: async () => {
      throw new Error('not used')
    },
  }
  return { repository, state }
}

function memoryRailCache() {
  const entries = new Map<string, PageDto<ArtifactSummaryDto>>()
  const cache: HomeRailCache = {
    read: async (sort, limit, locale) => entries.get(`${locale}:${sort}:${limit}`),
    write: async (sort, limit, locale, pageDto) => {
      entries.set(`${locale}:${sort}:${limit}`, pageDto)
    },
  }
  return { cache, entries }
}

describe('SearchArtifacts home rail cache', () => {
  it('serves an unfiltered rail from cache without touching D1 again', async () => {
    const { repository, state } = listingRepository()
    const { cache, entries } = memoryRailCache()
    const useCase = new SearchArtifacts(repository, emptySummaryTranslations(), cache)

    const first = await useCase.execute({ sort: 'popular', limit: 6, locale: 'en' })
    const second = await useCase.execute({ sort: 'popular', limit: 6, locale: 'en' })

    expect(state.searches).toBe(1)
    expect(second).toEqual(first)
    expect(entries.size).toBe(1)
  })

  it('bypasses the cache for a text search', async () => {
    const { repository, state } = listingRepository()
    const { cache } = memoryRailCache()
    const useCase = new SearchArtifacts(repository, emptySummaryTranslations(), cache)

    await useCase.execute({ text: 'git', limit: 6, locale: 'en' })

    expect(state.searches).toBe(1)
  })

  it('bypasses the cache when filters are applied', async () => {
    const { repository, state } = listingRepository()
    const { cache } = memoryRailCache()
    const useCase = new SearchArtifacts(repository, emptySummaryTranslations(), cache)

    await useCase.execute({ kinds: ['skill'], limit: 6, locale: 'en' })

    expect(state.searches).toBe(1)
  })
})
