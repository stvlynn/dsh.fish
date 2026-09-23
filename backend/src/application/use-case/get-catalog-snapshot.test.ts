import { describe, expect, it } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import type { CatalogSnapshotStore } from '../port/catalog-snapshot-store.js'
import type { CatalogSnapshotDto } from './get-catalog-snapshot.js'
import { GetCatalogSnapshot } from './get-catalog-snapshot.js'

const earlier = new Date('2025-01-01T00:00:00.000Z')
const later = new Date('2025-06-01T00:00:00.000Z')

function artifact(
  id: string,
  overrides: {
    readonly deprecated?: boolean
    readonly updatedAt?: Date
    readonly stats?: { stars: number; downloads: number; installs: number }
  } = {},
): Artifact {
  return Artifact.create({
    id,
    kind: 'bundle',
    displayName: id,
    summary: 'A bundle.',
    source: npmSource(id, '1.0.0'),
    payload: { kind: 'bundle', requiresBuild: false },
    ...(overrides.deprecated === undefined ? {} : { deprecated: overrides.deprecated }),
    ...(overrides.updatedAt === undefined ? {} : { updatedAt: overrides.updatedAt }),
    ...(overrides.stats === undefined ? {} : { stats: overrides.stats }),
  })
}

function memoryRepository(rows: Artifact[]) {
  const state = { rows, snapshotReads: 0 }
  const publicRows = () => state.rows.filter((row) => !row.deprecated)
  const repository: ArtifactRepository = {
    findById: async (id) => state.rows.find((row) => String(row.id) === String(id)),
    search: async () => {
      throw new Error('not used')
    },
    countByKind: async () => [],
    save: async (artifact) => {
      state.rows = [...state.rows.filter((row) => row.id !== artifact.id), artifact]
    },
    saveMany: async () => {},
    incrementInstalls: async () => {},
    recordMetricsSnapshot: async () => {},
    listIdsByOrigin: async () => [],
    listForSitemap: async () => {
      throw new Error('not used')
    },
    listForSnapshot: async () => {
      state.snapshotReads += 1
      return [...publicRows()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
    },
    catalogStats: async () => {
      const rows = publicRows()
      return {
        artifactCount: rows.length,
        maxUpdatedAtMs: Math.max(0, ...rows.map((row) => row.updatedAt.getTime())),
        installs: rows.reduce((total, row) => total + row.stats.installs, 0),
        stars: rows.reduce((total, row) => total + row.stats.stars, 0),
        downloads: rows.reduce((total, row) => total + row.stats.downloads, 0),
      }
    },
  }
  return { repository, state }
}

function memoryStore() {
  const entries = new Map<string, string>()
  const store: CatalogSnapshotStore = {
    read: async (dataVersion) => entries.get(dataVersion),
    write: async (dataVersion, body) => {
      entries.set(dataVersion, body)
    },
  }
  return { store, entries }
}

describe('GetCatalogSnapshot', () => {
  it('serializes every public artifact and none of the deprecated ones', async () => {
    const { repository } = memoryRepository([
      artifact('dsh-beta', { updatedAt: earlier }),
      artifact('dsh-alpha', { updatedAt: later, stats: { stars: 5, downloads: 40, installs: 2 } }),
      artifact('dsh-old', { deprecated: true, updatedAt: later }),
    ])
    const { store } = memoryStore()

    const snapshot = await new GetCatalogSnapshot(repository, store).snapshot()
    const body = JSON.parse(snapshot.body) as CatalogSnapshotDto

    expect(body.artifacts.map((row) => row.id)).toEqual(['dsh-alpha', 'dsh-beta'])
    expect(body.artifactCount).toBe(2)
    expect(body.dataVersion).toBe(snapshot.meta.dataVersion)
    const alpha = body.artifacts[0]
    expect(alpha).toMatchObject({
      kind: 'bundle',
      verified: false,
      deprecated: false,
      stats: { stars: 5, downloads: 40, installs: 2 },
    })
    expect(alpha?.sourceUrl).toContain('npmjs.com')
  })

  it('answers with the same version and body until the catalog changes', async () => {
    const { repository, state } = memoryRepository([
      artifact('dsh-alpha', { updatedAt: later }),
    ])
    const { store } = memoryStore()
    const useCase = new GetCatalogSnapshot(repository, store)

    const first = await useCase.snapshot()
    const second = await useCase.snapshot()

    expect(second.meta.dataVersion).toBe(first.meta.dataVersion)
    expect(second.body).toBe(first.body)
    // The second read came from the store: the catalog was only walked once.
    expect(state.snapshotReads).toBe(1)
  })

  it('moves the version when any publicly visible number changes', async () => {
    const { repository, state } = memoryRepository([
      artifact('dsh-alpha', { updatedAt: later, stats: { stars: 1, downloads: 0, installs: 0 } }),
    ])
    const { store } = memoryStore()
    const useCase = new GetCatalogSnapshot(repository, store)

    const before = await useCase.meta()
    state.rows = [
      artifact('dsh-alpha', { updatedAt: later, stats: { stars: 2, downloads: 0, installs: 0 } }),
    ]
    const after = await useCase.meta()

    expect(after.dataVersion).not.toBe(before.dataVersion)
  })

  it('reports the catalog shape through the cheap poll', async () => {
    const { repository } = memoryRepository([
      artifact('dsh-alpha', { updatedAt: earlier }),
      artifact('dsh-beta', { updatedAt: later }),
    ])
    const { store } = memoryStore()

    const meta = await new GetCatalogSnapshot(repository, store).meta()

    expect(meta.artifactCount).toBe(2)
    // `generatedAt` is the newest change in the data, not the render time.
    expect(meta.generatedAt).toBe(later.toISOString())
    expect(meta.dataVersion).toMatch(/^[0-9a-f]{64}$/)
  })
})
