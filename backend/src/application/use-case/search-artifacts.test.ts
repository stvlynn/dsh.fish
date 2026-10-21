import { describe, expect, it } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactQuery, ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import { page } from '../../domain/shared/pagination.js'
import type { SummaryTranslationRepository } from '../../domain/artifact/summary-translation.js'
import { SearchArtifacts } from './search-artifacts.js'

/** No translations stored; every lookup comes back empty. */
function emptySummaryTranslations(): SummaryTranslationRepository {
  return {
    find: async () => undefined,
    listFor: async () => [],
    save: async () => {},
  }
}


/** Captures the query instead of answering it; the read result is irrelevant here. */
function capturingRepository() {
  const queries: ArtifactQuery[] = []
  const repository: ArtifactRepository = {
    findById: async () => undefined,
    search: async (query: ArtifactQuery) => {
      queries.push(query)
      return page([], 0, query.page)
    },
    readFacetCounts: async () => undefined,
    refreshFacetCounts: async () => {},
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
  return { repository, queries }
}

describe('SearchArtifacts sort resolution', () => {
  it('passes a supported intent topic and locale to the repository', async () => {
    const { repository, queries } = capturingRepository()

    await new SearchArtifacts(repository, emptySummaryTranslations()).execute({
      topics: ['code-review'],
      locale: 'zh-CN',
    })

    expect(queries[0]?.topics).toEqual(['code-review'])
    expect(queries[0]?.locale).toBe('zh-CN')
  })

  it('rejects an uncurated topic instead of minting arbitrary landing pages', async () => {
    const { repository } = capturingRepository()
    await expect(
      new SearchArtifacts(repository, emptySummaryTranslations()).execute({ topics: ['postgres'] }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('accepts the rising sort and passes it through', async () => {
    const { repository, queries } = capturingRepository()

    await new SearchArtifacts(repository, emptySummaryTranslations()).execute({ sort: 'rising' })

    expect(queries[0]?.sort).toBe('rising')
  })

  it('rejects a sort the catalog does not support', async () => {
    const { repository } = capturingRepository()

    await expect(new SearchArtifacts(repository, emptySummaryTranslations()).execute({ sort: 'magic' })).rejects.toMatchObject(
      { code: 'INVALID_ARGUMENT' },
    )
  })

  it('falls back from relevance to popular when there is no query text', async () => {
    const { repository, queries } = capturingRepository()

    await new SearchArtifacts(repository, emptySummaryTranslations()).execute({ sort: 'relevance' })

    expect(queries[0]?.sort).toBe('popular')
  })

  it('maps a retired category alias onto the live browse id', async () => {
    const { repository, queries } = capturingRepository()

    await new SearchArtifacts(repository, emptySummaryTranslations()).execute({
      categories: ['coding'],
    })

    expect(queries[0]?.categories).toEqual(['git'])
  })

  it('rejects an unknown category', async () => {
    const { repository } = capturingRepository()
    await expect(
      new SearchArtifacts(repository, emptySummaryTranslations()).execute({
        categories: ['nope'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('SearchArtifacts summary localization', () => {
  it('keeps a previous summary while its replacement is pending', async () => {
    const item = Artifact.create({
      id: 'dsh-hello',
      kind: 'bundle',
      displayName: 'dsh-hello',
      summary: 'A bundle.',
      source: npmSource('dsh-hello', '1.0.0'),
      payload: { kind: 'bundle', requiresBuild: false },
    })
    const { repository } = capturingRepository()
    repository.search = async (query) => page([item], 1, query.page)

    const result = await new SearchArtifacts(repository, {
      find: async () => undefined,
      listFor: async () => [
        {
          artifactId: item.id,
          locale: 'zh-CN',
          sourceHash: 'stale',
          status: 'pending',
          text: '上一版摘要',
          updatedAt: new Date(),
        },
      ],
      save: async () => {},
    }).execute({ locale: 'zh-CN' })

    expect(result.items[0]?.summary).toBe('上一版摘要')
  })
})
