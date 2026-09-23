import type { KVNamespace } from '@cloudflare/workers-types'
import type {
  CatalogSnapshotMeta,
  CatalogSnapshotStore,
} from '../../application/port/catalog-snapshot-store.js'

/**
 * Old versions are useless once the catalog moves on, and KV storage is not
 * free — entries expire rather than accumulating one key per catalog change.
 */
const SNAPSHOT_TTL_SECONDS = 86_400

/**
 * The last metadata survives longer than a body: it is tiny, and it is what
 * `/catalog/version` falls back to when D1 refuses the aggregation.
 */
const META_TTL_SECONDS = 86_400
const META_KEY = 'catalog:snapshot:meta'

export class KvCatalogSnapshotStore implements CatalogSnapshotStore {
  constructor(private readonly kv: KVNamespace) {}

  async read(dataVersion: string): Promise<string | undefined> {
    return (await this.kv.get(snapshotKey(dataVersion))) ?? undefined
  }

  async write(dataVersion: string, body: string): Promise<void> {
    await this.kv.put(snapshotKey(dataVersion), body, { expirationTtl: SNAPSHOT_TTL_SECONDS })
  }

  async readMeta(): Promise<CatalogSnapshotMeta | undefined> {
    const value = await this.kv.get(META_KEY, 'json')
    return value === null ? undefined : asMeta(value)
  }

  async writeMeta(meta: CatalogSnapshotMeta): Promise<void> {
    await this.kv.put(META_KEY, JSON.stringify(meta), { expirationTtl: META_TTL_SECONDS })
  }
}

function snapshotKey(dataVersion: string): string {
  return `catalog:snapshot:${dataVersion}`
}

function asMeta(value: unknown): CatalogSnapshotMeta {
  if (!isMeta(value)) throw new Error('catalog snapshot meta held a malformed payload')
  return value
}

function isMeta(value: unknown): value is CatalogSnapshotMeta {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.dataVersion === 'string' &&
    typeof record.artifactCount === 'number' &&
    typeof record.generatedAt === 'string'
  )
}
