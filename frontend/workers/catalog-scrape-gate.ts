/**
 * Catalog reads that miss the anonymous HTML cache still reach D1. A seedbox
 * farm minting unique `/browse?q=` URLs queues the database until even
 * `SELECT 1` fails (D1 7429). Known scrape ASNs are rejected before the
 * container opens D1. This is not Bot Management: `verifiedBotCategory` is
 * empty because these clients spoof a desktop Chrome UA.
 *
 * Remaining unique-query traffic (residential proxies, polite crawlers) shares
 * a Worker-wide KV budget so FTS listings cannot re-queue D1.
 */
export const CATALOG_SCRAPE_ASNS = new Set([
  214483, // RapidSeedbox Ltd
])

export const CATALOG_SEARCH_BUDGET_PER_MINUTE = 10

export interface SearchBudgetStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function scrapeShedResponse(asn: number | undefined): Response | undefined {
  if (asn === undefined || !CATALOG_SCRAPE_ASNS.has(asn)) return undefined
  return shed429('3600')
}

export function isMeteredCatalogSearch(url: URL): boolean {
  const query = url.searchParams.get('q')
  return query !== null && query.trim() !== ''
}

export async function catalogSearchBudgetShed(
  url: URL,
  kv: SearchBudgetStore,
  now = Date.now(),
): Promise<Response | undefined> {
  if (!isMeteredCatalogSearch(url)) return undefined
  const key = `catalog:search-budget:${Math.floor(now / 60_000)}`
  const raw = await kv.get(key)
  const used = raw === null ? 0 : Number(raw)
  if (!Number.isFinite(used) || used < 0) {
    throw new Error('catalog search budget held a malformed counter')
  }
  if (used >= CATALOG_SEARCH_BUDGET_PER_MINUTE) return shed429('60')
  await kv.put(key, String(used + 1), { expirationTtl: 120 })
  return undefined
}

function shed429(retryAfter: string): Response {
  return new Response(null, {
    status: 429,
    headers: {
      'retry-after': retryAfter,
      'cache-control': 'no-store',
    },
  })
}
