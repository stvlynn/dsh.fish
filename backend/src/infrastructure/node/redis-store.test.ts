import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { RedisStore } from './redis-store.js'

describe('Redis-backed durable state', () => {
  it('preserves cursor keys, explicit expiry, deletion and JSON types', async () => {
    const client = {
      get: vi.fn().mockResolvedValue('{"complete":true}'),
      set: vi.fn(),
      del: vi.fn(),
    }
    const store = new RedisStore(client as unknown as Redis)
    expect(await store.get('cursor', 'json')).toEqual({ complete: true })
    await store.put('cursor', 'next')
    await store.put('session', 'signed', { expirationTtl: 37 })
    await store.delete('session')
    expect(client.get).toHaveBeenCalledWith('hub:kv:cursor')
    expect(client.set).toHaveBeenCalledWith('hub:kv:cursor', 'next')
    expect(client.set).toHaveBeenCalledWith('hub:kv:session', 'signed', 'EX', 37)
    expect(client.del).toHaveBeenCalledWith('hub:kv:session')
  })
  it('propagates corruption and connection failure instead of treating them as a cache miss', async () => {
    const client = { get: vi.fn().mockResolvedValue('broken') }
    const store = new RedisStore(client as unknown as Redis)
    await expect(store.get('cursor', 'json')).rejects.toThrow()
    client.get.mockRejectedValue(new Error('connection lost'))
    await expect(store.get('cursor')).rejects.toThrow('connection lost')
  })
})
