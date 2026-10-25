import type { KeyValueStore } from '../../application/port/key-value-store.js'
import type { CatalogSnapshotStore } from '../../application/port/catalog-snapshot-store.js'

/**
 * Old versions are useless once the catalog moves on, and KV storage is not
 * free — entries expire rather than accumulating one key per catalog change.
 */
const SNAPSHOT_TTL_SECONDS = 86_400

export class KvCatalogSnapshotStore implements CatalogSnapshotStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly generation = '',
  ) {}

  async read(dataVersion: string): Promise<string | undefined> {
    return (await this.kv.get(this.generation + snapshotKey(dataVersion))) ?? undefined
  }

  async write(dataVersion: string, body: string): Promise<void> {
    await this.kv.put(this.generation + snapshotKey(dataVersion), body, {
      expirationTtl: SNAPSHOT_TTL_SECONDS,
    })
  }
}

function snapshotKey(dataVersion: string): string {
  return `catalog:snapshot:${dataVersion}`
}
