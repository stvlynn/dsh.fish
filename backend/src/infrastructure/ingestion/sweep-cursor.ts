import type { KeyValueStore } from '../../application/port/key-value-store.js'

/**
 * One slice of the discovery query.
 *
 * GitHub's search API never returns more than 1000 results for a single query,
 * so the topic is partitioned into ranges that each fit under the ceiling: by
 * star count, and — for one star value too dense to halve — by created date.
 */
export interface ShardRange {
  /** Inclusive star floor. */
  readonly min: number
  /** Inclusive star ceiling; omitted reads as unbounded above. */
  readonly max?: number
  /** Created-date window, set only when the star range cannot be split further. */
  readonly created?: {
    readonly from: string
    /** Omitted reads as open-ended, so repositories created later still land. */
    readonly to?: string
  }
}

/** Where the next crawl resumes: which shard, and which page of it. */
export interface SweepPosition {
  readonly shards: readonly ShardRange[]
  readonly index: number
  readonly page: number
}

/**
 * Where the next crawl resumes.
 *
 * A sweep cannot read the whole topic in one Worker invocation — subrequests
 * are budgeted per invocation — so each run reads a slice and records where it
 * stopped. Without this, every run would re-read the head of the search, and
 * the long tail of the topic, which is where the small installable plugins
 * live, would never be indexed at all.
 */
export interface SweepCursor {
  /** The position a run should start from. Undefined when nothing usable is recorded. */
  read(): Promise<SweepPosition | undefined>
  write(position: SweepPosition): Promise<void>
}

/** Namespaced so the two indexers cannot collide on one key. */
export function sweepCursorKey(origin: string): string {
  return `crawler:${origin}:shard`
}

export class KvSweepCursor implements SweepCursor {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string,
  ) {}

  async read(): Promise<SweepPosition | undefined> {
    const raw = await this.kv.get(this.key)
    if (raw === null) return undefined
    try {
      // An unset, corrupt or stale-shape key restarts the sweep rather than
      // failing it: the crawl is idempotent, so the first shard is always safe.
      return normalizePosition(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  async write(position: SweepPosition): Promise<void> {
    await this.kv.put(this.key, JSON.stringify(position))
  }
}

/** Trust only what the indexer itself could have written. */
function normalizePosition(value: unknown): SweepPosition | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { shards, index, page } = value as Record<string, unknown>
  if (!Array.isArray(shards) || shards.length === 0) return undefined
  if (!Number.isInteger(index) || (index as number) < 0) return undefined
  if (!Number.isInteger(page) || (page as number) < 1) return undefined
  const ranges: ShardRange[] = []
  for (const shard of shards) {
    const range = normalizeShard(shard)
    if (range === undefined) return undefined
    ranges.push(range)
  }
  return {
    shards: ranges,
    index: Math.min(index as number, ranges.length - 1),
    page: page as number,
  }
}

function normalizeShard(value: unknown): ShardRange | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { min, max, created } = value as Record<string, unknown>
  if (!Number.isInteger(min) || (min as number) < 0) return undefined
  if (max !== undefined && (!Number.isInteger(max) || (max as number) < (min as number))) {
    return undefined
  }
  let window: ShardRange['created']
  if (created !== undefined) {
    if (typeof created !== 'object' || created === null) return undefined
    const { from, to } = created as Record<string, unknown>
    if (typeof from !== 'string' || (to !== undefined && typeof to !== 'string')) return undefined
    window = to === undefined ? { from } : { from, to }
  }
  return {
    min: min as number,
    ...(max === undefined ? {} : { max: max as number }),
    ...(window === undefined ? {} : { created: window }),
  }
}
