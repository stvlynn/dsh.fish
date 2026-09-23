import type { KVNamespace } from '@cloudflare/workers-types'
import type { ArtifactSummaryDto, PageDto } from '../../application/dto/artifact-dto.js'

/**
 * The home page's three rails are fixed queries: same sort, same limit, no
 * filters. They are also the heaviest reads on the site — tens of thousands of
 * rows per call — so a crawl that lands on `/` every second re-queues D1 even
 * when the database is healthy. Caching the rendered rails in KV for a short
 * window keeps the misses from being re-read on every request, and a degraded
 * rail is never written, so a failed read cannot poison the cache.
 */
const RAIL_TTL_SECONDS = 60

function railKey(sort: string, limit: number, locale: string): string {
  return `catalog:home-rail:${locale}:${sort}:${limit}`
}

export class KvHomeRailCache {
  constructor(private readonly kv: KVNamespace) {}

  async read(
    sort: string,
    limit: number,
    locale: string,
  ): Promise<PageDto<ArtifactSummaryDto> | undefined> {
    const value = await this.kv.get(railKey(sort, limit, locale), 'json')
    return value === null ? undefined : asPage(value)
  }

  async write(
    sort: string,
    limit: number,
    locale: string,
    page: PageDto<ArtifactSummaryDto>,
  ): Promise<void> {
    await this.kv.put(railKey(sort, limit, locale), JSON.stringify(page), {
      expirationTtl: RAIL_TTL_SECONDS,
    })
  }
}

function asPage(value: unknown): PageDto<ArtifactSummaryDto> {
  if (!isPage(value)) throw new Error('home rail cache held a malformed payload')
  return value
}

function isPage(value: unknown): value is PageDto<ArtifactSummaryDto> {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.items) &&
    typeof record.total === 'number' &&
    typeof record.limit === 'number' &&
    typeof record.offset === 'number'
  )
}
