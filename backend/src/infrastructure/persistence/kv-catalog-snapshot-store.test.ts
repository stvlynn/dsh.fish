import { describe, expect, it } from 'vitest'
import { KvCatalogSnapshotStore } from './kv-catalog-snapshot-store.js'

function memoryKv() {
  const entries = new Map<string, { value: string; expirationTtl?: number }>()
  return {
    entries,
    kv: {
      get: async (key: string) => {
        const entry = entries.get(key)
        return entry === undefined ? null : entry.value
      },
      put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
        entries.set(key, { value, expirationTtl: options?.expirationTtl })
      },
    },
  }
}

describe('KvCatalogSnapshotStore', () => {
  it('round-trips a snapshot body under its data version', async () => {
    const { kv } = memoryKv()
    const store = new KvCatalogSnapshotStore(kv as never)

    expect(await store.read('v1')).toBeUndefined()
    await store.write('v1', '{"artifacts":[]}')
    expect(await store.read('v1')).toBe('{"artifacts":[]}')
  })
})
