import { expect, test, type APIResponse } from '@playwright/test'
import {
  CATALOG_PAGE_SIZE,
  PAGINATION_FILLER_COUNT,
  paginationFillerId,
} from '../lib/pagination-fillers'
import { INSTALL_TARGET_FIXTURE_COUNT } from '../lib/install-target-fixtures'

/**
 * Real SQL pagination against the e2e D1, not a Worker-side slice of the
 * snapshot. The shared seed is one row per kind; seedLocalCatalog adds enough
 * fillers that `/browse` (page size 24) has a second page, plus the install-
 * target fixtures the install-panel suite reads.
 *
 * Six public seed rows + 20 fillers + 3 install-target fixtures = 29.
 * Default search hides the deprecated shim, so `total` is 29.
 */
const PUBLIC_TOTAL = 6 + PAGINATION_FILLER_COUNT + INSTALL_TARGET_FIXTURE_COUNT

type ArtifactPage = {
  items: { id: string }[]
  total: number
  limit: number
  offset: number
}

async function search(request: { get: (url: string) => Promise<APIResponse> }, query: string) {
  const response = await request.get(`/api/v1/artifacts?${query}`)
  expect(response.ok(), `GET /api/v1/artifacts?${query} → ${response.status()}`).toBe(true)
  return (await response.json()) as ArtifactPage
}

test.describe('catalog pagination', () => {
  test('pages in SQL against the stored list rank, not updated_at', async ({ request }) => {
    // Highest listRank in the seed is Postgres MCP (installs 231, stars 1290).
    // If popularity were left at 0, ORDER BY would fall through to updated_at
    // and acme-release-notes would lead.
    const first = await search(request, 'limit=24&offset=0')
    expect(first.total).toBe(PUBLIC_TOTAL)
    expect(first.limit).toBe(CATALOG_PAGE_SIZE)
    expect(first.offset).toBe(0)
    expect(first.items).toHaveLength(CATALOG_PAGE_SIZE)
    expect(first.items[0]?.id).toBe('dsh-postgres-mcp')
    expect(first.items.map((item) => item.id)).toContain('dsh-turtle-ui')
    expect(first.items.map((item) => item.id)).not.toContain(paginationFillerId(1))
  })

  test('offset pages are disjoint slices of the same total', async ({ request }) => {
    const pageSize = 2
    const seen = new Set<string>()
    for (let offset = 0; offset < PUBLIC_TOTAL; offset += pageSize) {
      const page = await search(request, `limit=${pageSize}&offset=${offset}`)
      expect(page.total).toBe(PUBLIC_TOTAL)
      expect(page.limit).toBe(pageSize)
      expect(page.offset).toBe(offset)
      expect(page.items.length).toBe(Math.min(pageSize, PUBLIC_TOTAL - offset))
      for (const item of page.items) {
        expect(seen.has(item.id), `id ${item.id} repeated at offset ${offset}`).toBe(false)
        seen.add(item.id)
      }
    }
    expect(seen.size).toBe(PUBLIC_TOTAL)
  })

  test('the second browse page is a real URL with a real prev link', async ({ page }) => {
    await page.goto('/browse', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(`${PUBLIC_TOTAL} results`)).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(CATALOG_PAGE_SIZE)

    const pager = page.getByRole('navigation', { name: 'Pagination' })
    await expect(pager).toBeVisible()
    await expect(pager.getByText('1 / 2')).toBeVisible()
    await expect(pager.getByRole('link', { name: 'Previous page' })).toHaveCount(0)
    const next = pager.getByRole('link', { name: 'Next page' })
    await expect(next).toHaveAttribute('href', /\/browse\?offset=24$/)
    await expect(next).toHaveAttribute('rel', 'next')

    await next.click()
    await expect(page).toHaveURL(/\/browse\?offset=24$/)
    await expect(page.getByRole('article')).toHaveCount(PUBLIC_TOTAL - CATALOG_PAGE_SIZE)
    await expect(pager.getByText('2 / 2')).toBeVisible()
    await expect(pager.getByRole('link', { name: 'Next page' })).toHaveCount(0)
    const previous = pager.getByRole('link', { name: 'Previous page' })
    await expect(previous).toHaveAttribute('href', /\/browse$/)
    await expect(previous).toHaveAttribute('rel', 'prev')

    const pageTwo = await page.getByRole('article').locator('h3').allTextContents()
    expect(pageTwo).toEqual([paginationFillerId(2), paginationFillerId(1)])
  })

  test('the snapshot stays a full-catalog document', async ({ request }) => {
    const response = await request.get('/api/v1/catalog/snapshot')
    expect(response.ok()).toBe(true)
    const body = (await response.json()) as { artifactCount: number; artifacts: { id: string }[] }
    expect(body.artifactCount).toBe(PUBLIC_TOTAL)
    expect(body.artifacts).toHaveLength(PUBLIC_TOTAL)
    expect(body.artifacts.map((row) => row.id)).toContain('dsh-postgres-mcp')
    expect(body.artifacts.map((row) => row.id)).toContain(paginationFillerId(1))
  })
})
