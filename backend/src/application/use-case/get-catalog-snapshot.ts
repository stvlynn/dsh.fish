import type {
  ArtifactRepository,
  CatalogStats,
} from '../../domain/artifact/artifact-repository.js'
import type { ArtifactSummaryDto } from '../dto/artifact-dto.js'
import { toSummaryDto } from '../dto/artifact-dto.js'
import type {
  CatalogSnapshotMeta,
  CatalogSnapshotStore,
} from '../port/catalog-snapshot-store.js'

export type { CatalogSnapshotMeta }

export interface CatalogSnapshotDto extends CatalogSnapshotMeta {
  readonly artifacts: readonly ArtifactSummaryDto[]
}

export interface CatalogSnapshot {
  readonly meta: CatalogSnapshotMeta
  /** Canonical JSON document, served verbatim so the ETag always matches the bytes. */
  readonly body: string
}

/**
 * The whole public catalog as one versioned document, for third-party
 * directories and bots that sync without crawling.
 *
 * The data version is derived from a cheap D1 aggregate rather than from
 * hashing the payload: every publicly visible change either moves one of the
 * summed counters or bumps `updatedAt`, so the aggregate identifies the
 * catalog exactly. That keeps `/catalog/version` a metadata-only read and lets
 * the snapshot itself be cached under the version — the same document is never
 * built twice.
 */
export class GetCatalogSnapshot {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly store: CatalogSnapshotStore,
  ) {}

  async meta(): Promise<CatalogSnapshotMeta> {
    const meta = await toMeta(await this.artifacts.catalogStats())
    return meta
  }

  async snapshot(): Promise<CatalogSnapshot> {
    const meta = await this.meta()
    const cached = await this.store.read(meta.dataVersion)
    if (cached !== undefined) return { meta, body: cached }

    const artifacts = await this.artifacts.listForSnapshot()
    const body = JSON.stringify({
      dataVersion: meta.dataVersion,
      artifactCount: meta.artifactCount,
      generatedAt: meta.generatedAt,
      artifacts: artifacts.map(toSummaryDto),
    } satisfies CatalogSnapshotDto)
    await this.store.write(meta.dataVersion, body)
    return { meta, body }
  }
}

async function toMeta(stats: CatalogStats): Promise<CatalogSnapshotMeta> {
  return {
    dataVersion: await sha256Hex(versionSeed(stats)),
    artifactCount: stats.artifactCount,
    // The newest change in the catalog, not the render time: the document is a
    // deterministic function of the data, so its meaningful timestamp is the
    // data's. An empty catalog has no data timestamp and falls back to now.
    generatedAt:
      stats.maxUpdatedAtMs === 0
        ? new Date().toISOString()
        : new Date(stats.maxUpdatedAtMs).toISOString(),
  }
}

/** Prefixed so the seed format can change without colliding with old KV keys. */
function versionSeed(stats: CatalogStats): string {
  return [
    'dsh.catalog/v1',
    stats.artifactCount,
    stats.maxUpdatedAtMs,
    stats.installs,
    stats.stars,
    stats.downloads,
  ].join(':')
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
