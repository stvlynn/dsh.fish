import type { KVNamespace } from '@cloudflare/workers-types'
import type { CatalogSnapshotStore } from '../../application/port/catalog-snapshot-store.js'

/**
 * Old versions are useless once the catalog moves on, and KV storage is not
 * free — entries expire rather than accumulating one key per catalog change.
 */
const SNAPSHOT_TTL_SECONDS = 86_400

export class KvCatalogSnapshotStore implements CatalogSnapshotStore {
  constructor(private readonly kv: KVNamespace) {}

  async read(dataVersion: string): Promise<string | undefined> {
    return (await this.kv.get(snapshotKey(dataVersion))) ?? undefined
  }

  async write(dataVersion: string, body: string): Promise<void> {
    await this.kv.put(snapshotKey(dataVersion), body, { expirationTtl: SNAPSHOT_TTL_SECONDS })
  }
}

function snapshotKey(dataVersion: string): string {
  return `catalog:snapshot:${dataVersion}`
}
