import type { KeyValueStore } from '../../application/port/key-value-store.js'

/**
 * Where an awesome-list sweep resumes: which list, and how far into it.
 *
 * Curated lists are small and append-mostly, so a plain offset is enough —
 * entries appended mid-sweep are picked up when the crawl wraps back to the
 * list, and an upstream rewrite that moves entries simply re-probes a few
 * repositories, which the manifest gate absorbs.
 */
export interface ListPosition {
  readonly list: number
  readonly offset: number
}

/**
 * The awesome-list counterpart of `SweepCursor`: one scheduled run cannot
 * probe every listed repository inside a Worker's subrequest budget, so each
 * run records where it stopped.
 */
export interface ListCursor {
  /** The position a run should start from. Undefined when nothing usable is recorded. */
  read(): Promise<ListPosition | undefined>
  write(position: ListPosition): Promise<void>
}

/** Namespaced so the list crawl cannot collide with the shard crawl's key. */
export function listCursorKey(origin: string): string {
  return `crawler:${origin}:list`
}

export class KvListCursor implements ListCursor {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string,
  ) {}

  async read(): Promise<ListPosition | undefined> {
    const raw = await this.kv.get(this.key)
    if (raw === null) return undefined
    try {
      // An unset, corrupt or stale-shape key restarts the sweep rather than
      // failing it: the crawl is idempotent, so the first list is always safe.
      return normalizePosition(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  async write(position: ListPosition): Promise<void> {
    await this.kv.put(this.key, JSON.stringify(position))
  }
}

/** Trust only what the indexer itself could have written. */
function normalizePosition(value: unknown): ListPosition | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { list, offset } = value as Record<string, unknown>
  if (!Number.isInteger(list) || (list as number) < 0) return undefined
  if (!Number.isInteger(offset) || (offset as number) < 0) return undefined
  return { list: list as number, offset: offset as number }
}
