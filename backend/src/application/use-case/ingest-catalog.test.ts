import { describe, expect, it } from 'vitest'
import { IngestCatalog } from './ingest-catalog.js'
import type { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import type { Slug } from '../../domain/shared/slug.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import type { IndexedSnapshot, SourceIndexer } from '../port/source-indexer.js'
import type { ScheduleReadmeLocalizationInput } from '../port/readme-localization.js'

/** Only what the sweep touches. The rest of the port is never reached here. */
function memoryRepository() {
  const rows = new Map<string, Artifact>()
  const saved: string[] = []
  const snapshots: string[] = []
  const repository: ArtifactRepository = {
    findById: async (id: Slug) => rows.get(String(id)),
    search: async () => {
      throw new Error('not used')
    },
    readFacetCounts: async () => undefined,
    refreshFacetCounts: async () => {},
    save: async (artifact: Artifact) => {
      saved.push(String(artifact.id))
      rows.set(String(artifact.id), artifact)
    },
    saveMany: async () => {},
    incrementInstalls: async () => {},
    recordMetricsSnapshot: async (artifact: Artifact) => {
      snapshots.push(String(artifact.id))
    },
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
  return { repository, rows, saved, snapshots }
}

function snapshot(overrides: Partial<IndexedSnapshot> = {}): IndexedSnapshot {
  return {
    id: 'dsh-hello-plugin',
    kind: 'bundle',
    displayName: 'dsh-hello-plugin',
    summary: 'A bundle.',
    source: npmSource('dsh-hello-plugin', '1.0.0'),
    payload: { kind: 'bundle', requiresBuild: false },
    keywords: [],
    categories: [],
    stats: { stars: 0, downloads: 0 },
    ...overrides,
  }
}

function indexer(origin: 'github' | 'npm', snapshots: readonly IndexedSnapshot[]) {
  const limits: number[] = []
  const source: SourceIndexer = {
    origin,
    discover: async (limit: number) => {
      limits.push(limit)
      return snapshots
    },
    indexOne: async () => undefined,
  }
  return { source, limits }
}

function ingest(
  repository: ArtifactRepository,
  indexers: readonly SourceIndexer[],
  scheduled: ScheduleReadmeLocalizationInput[] = [],
) {
  return new IngestCatalog(repository, indexers, {
    schedule: async (input) => {
      scheduled.push(input)
    },
  })
}

describe('IngestCatalog', () => {
  it('lands a row whose declared category is not in the taxonomy', async () => {
    // The sweep used to count this as `skipped`: the artifact was dropped
    // wholesale because of one advisory string.
    const { repository, rows } = memoryRepository()
    const github = indexer('github', [snapshot({ categories: ['AI Coding'] })])

    const report = await ingest(repository, [github.source]).execute()

    expect(report).toMatchObject({ scanned: 1, created: 1, skipped: 0 })
    expect(rows.get('dsh-hello-plugin')?.categories).toEqual(['other'])
  })

  it('re-applies categories to a row it already has', async () => {
    const { repository, rows } = memoryRepository()
    const first = indexer('github', [snapshot({ categories: [] })])
    await ingest(repository, [first.source]).execute()
    expect(rows.get('dsh-hello-plugin')?.categories).toEqual(['other'])

    // The author adds `dsh.hub.categories` and the next sweep picks it up.
    const second = indexer('github', [snapshot({ categories: ['dev'] })])
    const report = await ingest(repository, [second.source]).execute()

    expect(report).toMatchObject({ updated: 1, created: 0 })
    expect(rows.get('dsh-hello-plugin')?.categories).toEqual(['dev'])
  })

  it('writes a Social preview onto a new row', async () => {
    const { repository, rows } = memoryRepository()
    const preview = 'https://opengraph.githubassets.com/preview/acme/hello'
    const github = indexer('github', [snapshot({ ogImageUrl: preview })])

    await ingest(repository, [github.source]).execute()

    expect(rows.get('dsh-hello-plugin')?.ogImageUrl).toBe(preview)
  })

  it('pins the scanned commit on create and re-pins it on refresh', async () => {
    const { repository, rows } = memoryRepository()
    const first = indexer('github', [snapshot({ sourceCommitSha: 'a'.repeat(40) })])
    await ingest(repository, [first.source]).execute()
    expect(rows.get('dsh-hello-plugin')?.sourceCommitSha).toBe('a'.repeat(40))

    const second = indexer('github', [snapshot({ sourceCommitSha: 'b'.repeat(40) })])
    const report = await ingest(repository, [second.source]).execute()

    expect(report).toMatchObject({ updated: 1, created: 0 })
    expect(rows.get('dsh-hello-plugin')?.sourceCommitSha).toBe('b'.repeat(40))
  })

  it('spends a different candidate budget at each origin', async () => {
    const { repository } = memoryRepository()
    const github = indexer('github', [])
    const npm = indexer('npm', [])

    await ingest(repository, [github.source, npm.source]).execute({
      limitPerSource: 100,
      limitByOrigin: { github: 200 },
    })

    expect(github.limits).toEqual([200])
    expect(npm.limits).toEqual([100])
  })

  it('records one metrics snapshot per artifact per sweep', async () => {
    const { repository, snapshots } = memoryRepository()
    const first = indexer('github', [snapshot()])
    await ingest(repository, [first.source]).execute()
    expect(snapshots).toEqual(['dsh-hello-plugin'])

    // A re-sweep that finds only new stats appends another point of history,
    // which is what star velocity is later computed against.
    const second = indexer('github', [snapshot({ stats: { stars: 5, downloads: 10 } })])
    await ingest(repository, [second.source]).execute()
    expect(snapshots).toEqual(['dsh-hello-plugin', 'dsh-hello-plugin'])
  })

  it('writes nothing at all when a sweep finds the stored row unchanged', async () => {
    const { repository, saved, snapshots } = memoryRepository()
    await ingest(repository, [indexer('github', [snapshot({ readmeMarkdown: '# Hello' })]).source]).execute()
    expect(saved).toEqual(['dsh-hello-plugin'])
    expect(snapshots).toEqual(['dsh-hello-plugin'])

    const scheduled: ScheduleReadmeLocalizationInput[] = []
    const report = await ingest(
      repository,
      [indexer('github', [snapshot({ readmeMarkdown: '# Hello' })]).source],
      scheduled,
    ).execute()

    expect(report).toMatchObject({ scanned: 1, created: 0, updated: 0, unchanged: 1 })
    expect(saved).toEqual(['dsh-hello-plugin'])
    expect(snapshots).toEqual(['dsh-hello-plugin'])
    expect(scheduled).toEqual([])
  })

  it('records metrics but skips the catalog write when only stats moved', async () => {
    const { repository, saved, snapshots } = memoryRepository()
    await ingest(repository, [indexer('github', [snapshot()]).source]).execute()

    const second = indexer('github', [snapshot({ stats: { stars: 42, downloads: 7 } })])
    const report = await ingest(repository, [second.source]).execute()

    expect(report).toMatchObject({ updated: 1, unchanged: 0, created: 0 })
    // Only the creation wrote catalog rows; the stats-only sweep went straight
    // to the metrics snapshot, whose UPDATE also refreshes the counters.
    expect(saved).toEqual(['dsh-hello-plugin'])
    expect(snapshots).toEqual(['dsh-hello-plugin', 'dsh-hello-plugin'])
  })

  it('saves and re-localizes only when content changed, and only when the README did', async () => {
    const { repository, saved } = memoryRepository()
    const scheduled: ScheduleReadmeLocalizationInput[] = []
    await ingest(
      repository,
      [indexer('github', [snapshot({ readmeMarkdown: '# Hello' })]).source],
      scheduled,
    ).execute()
    expect(scheduled).toEqual([{ artifactId: 'dsh-hello-plugin', markdown: '# Hello', summary: 'A bundle.' }])

    // A content change with an untouched README must not pay the per-locale
    // scheduling reads again.
    const summaryChange = indexer('github', [
      snapshot({ summary: 'A better bundle.', readmeMarkdown: '# Hello' }),
    ])
    const report = await ingest(repository, [summaryChange.source], scheduled).execute()
    expect(report).toMatchObject({ updated: 1, unchanged: 0 })
    expect(saved).toEqual(['dsh-hello-plugin', 'dsh-hello-plugin'])
    expect(scheduled).toHaveLength(1)

    // A README change reschedules localization.
    const readmeChange = indexer('github', [
      snapshot({ summary: 'A better bundle.', readmeMarkdown: '# Hello v2' }),
    ])
    await ingest(repository, [readmeChange.source], scheduled).execute()
    expect(scheduled).toEqual([
      { artifactId: 'dsh-hello-plugin', markdown: '# Hello', summary: 'A bundle.' },
      { artifactId: 'dsh-hello-plugin', markdown: '# Hello v2', summary: 'A better bundle.' },
    ])
  })

  it('durably schedules README localization after a catalog write', async () => {
    const { repository, rows } = memoryRepository()
    const scheduled: ScheduleReadmeLocalizationInput[] = []
    const github = indexer('github', [snapshot({ readmeMarkdown: '# Hello' })])

    const report = await ingest(repository, [github.source], scheduled).execute()

    expect(report).toMatchObject({ created: 1, errors: [] })
    expect(rows.has('dsh-hello-plugin')).toBe(true)
    expect(scheduled).toEqual([{ artifactId: 'dsh-hello-plugin', markdown: '# Hello', summary: 'A bundle.' }])
  })

  it('does not schedule localization for a plugin with no README', async () => {
    const { repository } = memoryRepository()
    const scheduled: ScheduleReadmeLocalizationInput[] = []

    await ingest(repository, [indexer('npm', [snapshot()]).source], scheduled).execute()

    expect(scheduled).toEqual([])
  })
})
