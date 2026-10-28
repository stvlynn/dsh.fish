import { expect, test } from '@playwright/test'
import { awaitHydration } from '../lib/hydration.ts'

/**
 * The facet bound, end to end: the filter rail stops offering what the server
 * would refuse, the server refuses it anyway, and the rail navigates without a
 * document load.
 *
 * The bound exists because production saw a crawler enumerate `/browse` by
 * following the rail's links one toggle at a time — 4–14 categories per URL,
 * each a fresh database query. See `backend/src/domain/artifact/facet-bounds.ts`.
 */

const CATEGORY_LIMIT = 3

test.describe('catalog facet bounds', () => {
  test('stops offering category links once the bound is reached', async ({ page }) => {
    await page.goto('/browse?category=ui&category=git&category=docs')

    const rail = page.locator('aside')
    // The three selected chips stay links, so each can be cleared.
    await expect(rail.locator('a[aria-pressed="true"]')).toHaveCount(CATEGORY_LIMIT)
    // Every other category is still shown, but nothing links to a fourth.
    const unavailable = rail.locator('span[aria-disabled="true"]')
    await expect(unavailable.first()).toBeVisible()
    expect(await unavailable.count()).toBeGreaterThan(0)
    await expect(unavailable.first()).toHaveAttribute('title', `Up to ${CATEGORY_LIMIT} at once. Clear one to pick another.`)
    for (const href of await rail.locator('a[href*="category="]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    )) {
      expect(new URL(href, 'https://x').searchParams.getAll('category').length).toBeLessThanOrEqual(CATEGORY_LIMIT)
    }
  })

  test('refuses an over-bound combination with a real 404', async ({ page, request }) => {
    const path = '/browse?category=ui&category=git&category=docs&category=theme'
    const document = await request.get(path)
    expect(document.status()).toBe(404)

    const api = await request.get('/api/v1/artifacts?category=ui&category=git&category=docs&category=theme')
    expect(api.status()).toBe(400)
    expect((await api.json()).error.details).toMatchObject({ facet: 'categories', limit: CATEGORY_LIMIT })

    // A browser navigation gets the same status the crawler does.
    const navigation = await page.goto(path)
    expect(navigation?.status()).toBe(404)
  })

  test('writes the same URL for the same selection in either click order', async ({ page }) => {
    await page.goto('/browse?category=git')
    const viaGitFirst = await page.locator('aside a', { hasText: /^Docs$/ }).getAttribute('href')
    await page.goto('/browse?category=docs')
    const viaDocsFirst = await page.locator('aside a', { hasText: /^Git$/ }).getAttribute('href')
    expect(viaGitFirst).toBe(viaDocsFirst)
  })

  test('toggles a filter with client navigation, not a document load', async ({ page }) => {
    // Before hydration a link is only an anchor, and the browser does what an
    // anchor does. The claim under test is about the hydrated page, so wait
    // for the client's own signal rather than for the network to go quiet.
    await page.goto('/browse')
    await awaitHydration(page)
    const documents: string[] = []
    const data: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(request.url())
      else if (new URL(request.url()).pathname.endsWith('.data')) data.push(request.url())
    })

    await page.locator('aside a[href*="category="]').first().click()
    await expect(page).toHaveURL(/category=/)

    expect(documents).toEqual([])
    expect(data.length).toBeGreaterThan(0)
  })
})
