import { expect, test, type Locator, type Page } from '@playwright/test'
import { SCREENSHOT_DEVICES } from './lib/devices'
import { openPluginReadme } from './lib/open-plugin-readme'
import { horizontalOverflowHits, pageScrollWidth } from './lib/overflow'

test.describe('plugin detail readme on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await openPluginReadme(page)
  })

  test('renders GFM structure without handing the page to raw HTML', async ({ page }) => {
    const readme = page.locator('#readme')

    await expect(page.getByRole('heading', { name: 'Postgres MCP', level: 1 })).toBeVisible()
    // Readme headings are demoted by two so they sit below the page and section.
    await expect(readme.getByRole('heading', { name: 'Postgres MCP', level: 3 })).toBeVisible()
    await expect(readme.getByRole('heading', { name: 'Configuration', level: 4 })).toBeVisible()
    await expect(readme.getByRole('heading', { name: "What's next?", level: 4 })).toBeVisible()
    await expect(readme.locator('h1')).toHaveCount(0)
    await expect(readme.getByRole('heading', { level: 2 })).toHaveCount(1)

    await expect(readme.locator('table')).toHaveCount(1)
    await expect(readme.locator('pre')).toHaveCount(1)
    await expect(readme.getByRole('checkbox')).toHaveCount(2)
    await expect(readme.locator('blockquote')).toContainText('replica is the default')
    await expect(readme.locator('del')).toContainText('old TCP port map')

    await expect(readme.getByRole('link', { name: 'setup guide' })).toHaveAttribute(
      'href',
      /https:\/\/github.com\/acme\/postgres-mcp\/blob\/[0-9a-f]+\/docs\/guide.md/,
    )
    await expect(readme.getByRole('img', { name: 'Architecture' })).toHaveAttribute(
      'src',
      /https:\/\/github.com\/acme\/postgres-mcp\/raw\/[0-9a-f]+\/docs\/architecture.png/,
    )

    await expect(readme.locator('script')).toHaveCount(0)
    await expect(readme).not.toContainText('<script')
    await expect(readme).not.toContainText('onclick')
  })

  test('keeps the page itself from scrolling sideways', async ({ page }) => {
    const { clientWidth, scrollWidth } = await pageScrollWidth(page)
    expect(scrollWidth, `document scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`).toBeLessThanOrEqual(
      clientWidth + 1,
    )

    const hits = await horizontalOverflowHits(page)
    expect(hits, overflowMessage(hits, clientWidth)).toEqual([])
  })

  test('scrolls a wide table and a long fence inside themselves', async ({ page }) => {
    const table = page.locator('#readme table')
    const tableWrap = table.locator('xpath=..')
    await expect(tableWrap).toHaveCSS('overflow-x', 'auto')
    await expect.poll(() => isWiderThanBox(tableWrap)).toBeTruthy()
    await expect.poll(() => boxFitsViewport(page, tableWrap)).toBeTruthy()

    const fence = page.locator('#readme pre')
    await expect(fence).toHaveCSS('overflow-x', 'auto')
    await expect.poll(() => isWiderThanBox(fence)).toBeTruthy()
    await expect.poll(() => boxFitsViewport(page, fence)).toBeTruthy()
  })

  test('shrinks a wide screenshot to the column and leaves inline badges inline', async ({ page }) => {
    const readme = page.locator('#readme')
    const hero = readme.getByRole('img', { name: 'Architecture' })
    const badges = readme.getByRole('img', { name: 'ci' })

    await expect.poll(async () => {
      const image = await hero.boundingBox()
      const column = await readme.boundingBox()
      if (!image || !column) return false
      return image.width <= column.width + 1
    }).toBeTruthy()

    await expect.poll(async () => {
      const image = await hero.boundingBox()
      return image !== null && image.width < 800
    }).toBeTruthy()

    const badgeBox = await badges.boundingBox()
    expect(badgeBox).not.toBeNull()
    expect(badgeBox!.width).toBeLessThan(120)
  })

  test('wraps a long DSN instead of expanding the column', async ({ page }) => {
    const paragraph = page.locator('#readme p', { hasText: 'connection string must not blow' })
    await expect.poll(async () => {
      const box = await paragraph.boundingBox()
      const viewport = page.viewportSize()
      if (!box || !viewport) return false
      return box.width <= viewport.width - 16
    }).toBeTruthy()
  })

  test('stacks the install panel below the readme', async ({ page }) => {
    const readme = page.locator('#readme')
    const install = page.getByRole('heading', { name: 'Install', level: 2 })
    const readmeBox = await readme.boundingBox()
    const installBox = await install.boundingBox()
    expect(readmeBox).not.toBeNull()
    expect(installBox).not.toBeNull()
    // Below `lg` the grid is one column; every device in this suite is < 1024px.
    expect(installBox!.y).toBeGreaterThan(readmeBox!.y + readmeBox!.height - 8)
  })

  test('matches the first fold of the readme', async ({ page }, info) => {
    test.skip(!SCREENSHOT_DEVICES.has(info.project.name), 'Baselines are stored for iPhone SE (3rd gen) and Pixel 7')

    const readme = page.locator('#readme')
    await readme.evaluate((node) => {
      node.scrollIntoView({ block: 'start', inline: 'nearest' })
    })
    // Snap to a whole-pixel scroll offset: a fractional scrollY shifts text
    // rasterisation across the whole fold, which flakes the snapshot.
    await page.evaluate(() => window.scrollTo(0, Math.round(window.scrollY)))
    const clip = await firstFoldClip(page)
    await expect(page).toHaveScreenshot('readme-fold.png', {
      animations: 'disabled',
      caret: 'hide',
      clip,
      maxDiffPixelRatio: 0.03,
    })
  })
})

function overflowMessage(hits: Awaited<ReturnType<typeof horizontalOverflowHits>>, clientWidth: number): string {
  if (hits.length === 0) return ''
  return `viewport ${clientWidth}px, overflowing: ${hits
    .map((hit) => `${hit.tag}${hit.id ? `#${hit.id}` : ''}@${hit.right} (${hit.width}px)`)
    .join(', ')}`
}

async function isWiderThanBox(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
}

async function boxFitsViewport(page: Page, locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) return false
  return box.x >= -1 && box.x + box.width <= viewport.width + 1
}

async function firstFoldClip(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('#readme').boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) {
    throw new Error('Cannot snapshot the readme: bounding box or viewport missing')
  }
  const y = Math.max(0, box.y)
  return {
    x: Math.max(0, box.x),
    y,
    width: Math.min(box.width, viewport.width),
    height: Math.min(Math.max(box.height, 1), viewport.height - y),
  }
}
