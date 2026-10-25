import { Redis } from 'ioredis'
import type { KeyValueStore } from '../../application/port/key-value-store.js'

/** A separate namespace keeps cache/auth keys away from BullMQ's data model. */
export class RedisStore implements KeyValueStore {
  constructor(
    readonly client: Redis,
    private readonly prefix = 'hub:kv:',
  ) {}

  get(key: string): Promise<string | null>
  get(key: string, type: 'text'): Promise<string | null>
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>
  async get<T>(key: string, type?: 'text' | 'json'): Promise<string | T | null> {
    const value = await this.client.get(this.prefix + key)
    return value === null || type !== 'json' ? value : (JSON.parse(value) as T)
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (options?.expirationTtl !== undefined) {
      await this.client.set(this.prefix + key, value, 'EX', options.expirationTtl)
    } else {
      await this.client.set(this.prefix + key, value)
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefix + key)
  }
}
