import { describe, expect, it } from 'vitest'
import type { CatalogSnapshotMeta } from '../../application/port/catalog-snapshot-store.js'
import { KvCatalogSnapshotStore } from './kv-catalog-snapshot-store.js'

const meta: CatalogSnapshotMeta = {
  dataVersion: 'a'.repeat(64),
  artifactCount: 11019,
  generatedAt: '2026-09-23T09:05:22.600Z',
}

function memoryKv() {
  const entries = new Map<string, { value: string; expirationTtl?: number }>()
  return {
    entries,
    kv: {
      // Bodies are stored as plain text; metadata is stored as JSON.
      get: async (key: string, type?: 'json') => {
        const entry = entries.get(key)
        if (entry === undefined) return null
        return type === 'json' ? (JSON.parse(entry.value) as unknown) : entry.value
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

  it('round-trips the last recorded metadata', async () => {
    const { kv } = memoryKv()
    const store = new KvCatalogSnapshotStore(kv as never)

    expect(await store.readMeta()).toBeUndefined()
    await store.writeMeta(meta)
    expect(await store.readMeta()).toEqual(meta)
  })

  it('rejects malformed metadata instead of serving it', async () => {
    const { kv, entries } = memoryKv()
    entries.set('catalog:snapshot:meta', { value: '{"artifactCount":1}' })
    const store = new KvCatalogSnapshotStore(kv as never)

    await expect(store.readMeta()).rejects.toThrow('malformed payload')
  })

  it('keeps the last built body under a stable key for fallback reads', async () => {
    const { kv, entries } = memoryKv()
    const store = new KvCatalogSnapshotStore(kv as never)

    expect(await store.readLastBody()).toBeUndefined()
    await store.write('v1', '{"artifacts":[]}')
    expect(await store.readLastBody()).toBe('{"artifacts":[]}')

    // A newer version replaces it: the fallback is the newest document built,
    // not the first one.
    await store.write('v2', '{"artifacts":[1]}')
    expect(await store.readLastBody()).toBe('{"artifacts":[1]}')
    expect(entries.has('catalog:snapshot:last-body')).toBe(true)
  })
})
