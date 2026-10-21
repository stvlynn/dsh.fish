import { describe, expect, it } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import { githubSource, npmSource } from '../../domain/artifact/source-ref.js'
import { page } from '../../domain/shared/pagination.js'
import type { Slug } from '../../domain/shared/slug.js'
import type { OffsetCursor } from '../port/offset-cursor.js'
import { ReclassifyCatalog } from './reclassify-catalog.js'

function artifact(overrides: {
  id?: string
  summary?: string
  keywords?: readonly string[]
  categories?: readonly string[]
  source?: Artifact['source']
  readmeMarkdown?: string
}): Artifact {
  return Artifact.create({
    id: overrides.id ?? 'dsh-hello-plugin',
    kind: 'bundle',
    displayName: overrides.id ?? 'dsh-hello-plugin',
    summary: overrides.summary ?? 'A bundle.',
    source: overrides.source ?? githubSource({ owner: 'acme', repo: 'hello' }),
    payload: { kind: 'bundle', requiresBuild: false },
    keywords: overrides.keywords ?? [],
    categories: overrides.categories ?? ['other'],
    ...(overrides.readmeMarkdown === undefined
      ? {}
      : { readmeMarkdown: overrides.readmeMarkdown }),
    stats: { stars: 0, downloads: 0, installs: 0 },
  })
}

/** The listing projection: same facts, no README. Saving this would wipe the body. */
function listed(row: Artifact): Artifact {
  return Artifact.create({
    id: String(row.id),
    kind: row.kind,
    displayName: row.displayName,
    summary: row.summary,
    source: row.source,
    payload: row.payload,
    keywords: row.keywords,
    categories: row.categories.map(String),
    stats: row.stats,
  })
}

function memory(rows: Artifact[]) {
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const saved: Artifact[] = []
  const repository: ArtifactRepository = {
    findById: async (id: Slug) => byId.get(String(id)),
    search: async (query) => {
      const items = [...byId.values()]
        .map(listed)
        .slice(query.page.offset, query.page.offset + query.page.limit)
      return page(items, byId.size, query.page)
    },
    readFacetCounts: async () => undefined,
    refreshFacetCounts: async () => {},
    save: async (row) => {
      saved.push(row)
      byId.set(String(row.id), row)
    },
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
  return { repository, saved, byId }
}

function cursor(start = 0): OffsetCursor & { written: number[] } {
  const written: number[] = []
  let offset = start
  return {
    written,
    read: async () => offset,
    write: async (next) => {
      offset = next
      written.push(next)
    },
  }
}

describe('ReclassifyCatalog', () => {
  it('rewrites a row the curated overlay names, keeping the stored readme', async () => {
    const stored = artifact({
      categories: ['other'],
      readmeMarkdown: '# Hello from the source.',
    })
    const { repository, saved } = memory([stored])

    const report = await new ReclassifyCatalog(repository, {
      load: async () => new Map([['acme/hello', 'memory']]),
    }).execute({ limit: 10, offset: 0 })

    expect(report).toMatchObject({ scanned: 1, updated: 1, unchanged: 0 })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.categories).toEqual(['memory'])
    expect(saved[0]?.readmeMarkdown).toBe('# Hello from the source.')
  })

  it('does not write a row whose categories already match', async () => {
    const stored = artifact({ categories: ['memory'] })
    const { repository, saved } = memory([stored])

    const report = await new ReclassifyCatalog(repository, {
      load: async () => new Map([['acme/hello', 'memory']]),
    }).execute({ offset: 0 })

    expect(report.updated).toBe(0)
    expect(report.unchanged).toBe(1)
    expect(saved).toEqual([])
  })

  it('infers from keywords when the overlay does not name the row', async () => {
    const stored = artifact({
      keywords: ['postgres', 'sql'],
      categories: ['other'],
    })
    const { repository, saved } = memory([stored])

    await new ReclassifyCatalog(repository, {
      load: async () => new Map(),
    }).execute({ offset: 0 })

    expect(saved[0]?.categories).toEqual(['docs'])
  })

  it('does not apply a GitHub overlay to an npm row', async () => {
    const stored = artifact({
      source: npmSource('dsh-hello-plugin', '1.0.0'),
      categories: ['other'],
    })
    const { repository, saved } = memory([stored])

    const report = await new ReclassifyCatalog(repository, {
      load: async () => new Map([['acme/hello', 'memory']]),
    }).execute({ offset: 0 })

    expect(report.updated).toBe(0)
    expect(saved).toEqual([])
  })

  it('advances and wraps the resume cursor', async () => {
    const rows = [
      artifact({ id: 'a', categories: ['memory'] }),
      artifact({ id: 'b', categories: ['memory'] }),
    ]
    const { repository } = memory(rows)
    const resume = cursor(0)

    const first = await new ReclassifyCatalog(
      repository,
      { load: async () => new Map() },
      resume,
    ).execute({ limit: 1 })
    expect(first.offset).toBe(1)

    const second = await new ReclassifyCatalog(
      repository,
      { load: async () => new Map() },
      resume,
    ).execute({ limit: 1 })
    expect(second.offset).toBe(0)
    expect(resume.written).toEqual([1, 0])
  })
})
