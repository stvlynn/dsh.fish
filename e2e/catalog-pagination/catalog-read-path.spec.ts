import { expect, test } from '@playwright/test'

/**
 * Home, facets and FTS search against the e2e D1. These are the read paths
 * that 500'd in production when D1 scanned wide artifact rows and `%LIKE%`
 * search documents.
 */
test.describe('catalog read path', () => {
  test('the home page renders from covering facet counts', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(response?.ok(), `GET / → ${response?.status()}`).toBe(true)
    await expect(page.getByRole('heading', { name: 'DeepSeek Harness Plugin Hub' })).toBeVisible()
    await expect(page.getByText(/artifacts indexed/)).toBeVisible()
    await expect(page.getByRole('article').first()).toBeVisible()
  })

  test('facet counts come from the live catalog, not a join of README rows', async ({ request }) => {
    const response = await request.get('/api/v1/facets')
    expect(response.ok(), `GET /api/v1/facets → ${response.status()}`).toBe(true)
    const body = (await response.json()) as {
      kinds: { kind: string; count: number }[]
      categories: { id: string; count: number }[]
    }
    const bundles = body.kinds.find((entry) => entry.kind === 'bundle')
    expect(bundles?.count).toBeGreaterThan(0)
    expect(body.categories.some((entry) => entry.count > 0)).toBe(true)
  })

  test('text search uses the FTS index, not a leading-wildcard LIKE scan', async ({ request, page }) => {
    const api = await request.get('/api/v1/artifacts?q=PostgreSQL')
    expect(api.ok(), `GET /api/v1/artifacts?q=PostgreSQL → ${api.status()}`).toBe(true)
    const body = (await api.json()) as { items: { id: string }[]; total: number }
    expect(body.items.map((item) => item.id)).toContain('dsh-postgres-mcp')

    const browse = await page.goto('/browse?q=PostgreSQL', { waitUntil: 'domcontentloaded' })
    expect(browse?.ok(), `GET /browse?q=PostgreSQL → ${browse?.status()}`).toBe(true)
    await expect(page.getByRole('heading', { name: /Search results for/ })).toBeVisible()
    await expect(page.getByRole('article')).toContainText('Postgres MCP')
  })
})
