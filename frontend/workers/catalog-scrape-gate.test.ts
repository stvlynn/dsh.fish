import { describe, expect, it } from 'vitest'
import {
  CATALOG_SEARCH_BUDGET_PER_MINUTE,
  catalogSearchBudgetShed,
  isMeteredCatalogSearch,
  scrapeShedResponse,
} from './catalog-scrape-gate'

describe('scrapeShedResponse', () => {
  it('sheds the RapidSeedbox ASN before D1', () => {
    const response = scrapeShedResponse(214483)
    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('3600')
  })

  it('lets ordinary networks through', () => {
    expect(scrapeShedResponse(undefined)).toBeUndefined()
    expect(scrapeShedResponse(13335)).toBeUndefined()
  })
})

describe('isMeteredCatalogSearch', () => {
  it('meters non-empty q= and ignores listings', () => {
    expect(isMeteredCatalogSearch(new URL('https://dsh.fish/browse?q=postgres'))).toBe(true)
    expect(isMeteredCatalogSearch(new URL('https://dsh.fish/browse'))).toBe(false)
    expect(isMeteredCatalogSearch(new URL('https://dsh.fish/browse?q=%20'))).toBe(false)
  })
})

describe('catalogSearchBudgetShed', () => {
  it('allows the documented budget and sheds the next search', async () => {
    const kv = memoryKv()
    const url = new URL('https://dsh.fish/browse?q=git')
    for (let i = 0; i < CATALOG_SEARCH_BUDGET_PER_MINUTE; i += 1) {
      expect(await catalogSearchBudgetShed(url, kv, 1_000_000)).toBeUndefined()
    }
    const shed = await catalogSearchBudgetShed(url, kv, 1_000_000)
    expect(shed?.status).toBe(429)
    expect(shed?.headers.get('retry-after')).toBe('60')
  })

  it('does not consume the budget for listings without q=', async () => {
    const kv = memoryKv()
    expect(await catalogSearchBudgetShed(new URL('https://dsh.fish/browse'), kv)).toBeUndefined()
    expect(kv.entries.size).toBe(0)
  })
})

function memoryKv() {
  const entries = new Map<string, string>()
  return {
    entries,
    get: async (key: string) => entries.get(key) ?? null,
    put: async (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}
