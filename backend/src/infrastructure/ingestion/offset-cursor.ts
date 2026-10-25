import type { KeyValueStore } from '../../application/port/key-value-store.js'
import type { OffsetCursor } from '../../application/port/offset-cursor.js'

/**
 * A single integer resume position.
 *
 * Reclassify pages the catalog rather than the GitHub topic, so a shard
 * cursor would be the wrong shape: there is one ordered list of rows and
 * an offset into it.
 */
export function reclassifyCursorKey(): string {
  return 'crawler:reclassify:offset'
}

export class KvOffsetCursor implements OffsetCursor {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string,
  ) {}

  async read(): Promise<number | undefined> {
    const raw = await this.kv.get(this.key)
    if (raw === null) return undefined
    const offset = Number.parseInt(raw, 10)
    if (!Number.isInteger(offset) || offset < 0) return undefined
    return offset
  }

  async write(offset: number): Promise<void> {
    await this.kv.put(this.key, String(offset))
  }
}
