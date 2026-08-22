import { expect, test, type Page } from '@playwright/test'
import { awaitHydration } from '../lib/hydration.ts'
import { E2E_ORIGIN } from '../lib/origin'

const GITHUB = '/a/dsh-postgres-mcp'
const NPM = '/a/dsh-turtle-ui'
const ASK = '**/api/v1/artifacts/*/ask'
const QUERY_ID = 'what-is-this-plugin_11111111-2222-3333-4444-555555555555'
const DEEPWIKI_FAVICON = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function sseBody(extraDelta = 'It exposes Postgres as tools.'): string {
  return [
    'event: file',
    'data: {"repo":"acme/postgres-mcp","path":"src/index.ts"}',
    '',
    'event: delta',
    `data: ${JSON.stringify({ text: extraDelta })}`,
    '',
    'event: cite',
    'data: {"repo":"acme/postgres-mcp","path":"src/index.ts","start":1,"end":20}',
    '',
    'event: done',
    'data: {}',
    '',
  ].join('\n')
}

async function mockAsk(
  page: Page,
  handler: (post: { question: string; queryId?: string }) => {
    status: number
    body: string
    queryId?: string
    contentType?: string
  },
) {
  await page.route(ASK, async (route) => {
    const post = (route.request().postDataJSON() ?? {}) as { question: string; queryId?: string }
    const result = handler(post)
    await route.fulfill({
      status: result.status,
      contentType: result.contentType ?? (result.status === 200 ? 'text/event-stream' : 'application/json'),
      headers:
        result.status === 200
          ? { 'x-ask-query-id': result.queryId ?? QUERY_ID, 'cache-control': 'no-store' }
          : {},
      body: result.body,
    })
  })
}

function askSurface(page: Page) {
  return page.locator('#ask-panel, [role="dialog"][aria-modal="true"]').filter({
    has: page.getByLabel('Ask about this repository…'),
  })
}

function askSheet(page: Page) {
  return page.locator('[role="dialog"][aria-modal="true"]').filter({
    has: page.getByLabel('Ask about this repository…'),
  })
}

function suggestions(page: Page) {
  return page.locator('section').filter({
    has: page.getByRole('heading', { name: 'You might ask' }),
  })
}

function isDesktopViewport(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024
}

/**
 * The column vs sheet split is an effect after hydration. Clicking the toggle
 * before that runs opens the mobile sheet on a 1280px page, and the send
 * control lives on a surface the rest of the test is not looking at.
 */
async function gotoAskable(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' })
  await awaitHydration(page)
  if (path === NPM) return
  await expect(page.locator('[data-ask-layout]')).toHaveAttribute(
    'data-ask-layout',
    isDesktopViewport(page) ? 'column' : 'sheet',
  )
}

async function openAsk(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ask this project' }).click()
  await expect(askSurface(page)).toBeVisible()
  await expect(askSurface(page).getByLabel('Ask about this repository…')).toBeVisible()
}

test.describe('artifact ask', () => {
  test.beforeEach(async ({ context, page }) => {
    // The community stack sits in the same corner as the ask toggle and
    // intercepts clicks. Retire it the way a returning reader would.
    await context.addCookies([{ name: 'community', value: 'discord.x.feedback', url: E2E_ORIGIN }])
    // Citations resolve favicons from the citation URL. CI must not depend on
    // deepwiki.com answering `/favicon.ico`.
    await page.route('https://deepwiki.com/**', async (route) => {
      await route.fulfill({ contentType: 'image/png', body: DEEPWIKI_FAVICON })
    })
  })

  test('shows the rail control on GitHub plugins and not on npm', async ({ page }) => {
    await gotoAskable(page, GITHUB)
    await expect(page.getByRole('button', { name: 'Ask this project' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Install', level: 2 })).toBeVisible()

    await gotoAskable(page, NPM)
    await expect(page.getByRole('button', { name: 'Ask this project' })).toHaveCount(0)
    // No thread to answer them, so the openers do not render either.
    await expect(suggestions(page)).toHaveCount(0)
  })

  test('asks a suggested question and can redraw the set', async ({ page }) => {
    const posts: Array<{ question: string; queryId?: string }> = []
    await mockAsk(page, (post) => {
      posts.push(post)
      return { status: 200, body: sseBody() }
    })

    await gotoAskable(page, GITHUB)
    const card = suggestions(page)
    const options = card.locator('li button')
    await expect(options).toHaveCount(3)
    await expect(options.first()).toBeVisible()

    const drawn = await options.allInnerTexts()
    await card.getByRole('button', { name: 'Show other questions' }).click()
    await expect.poll(() => options.allInnerTexts()).not.toEqual(drawn)

    const question = (await options.first().innerText()).trim()
    await options.first().click()
    await expect(askSurface(page).getByLabel('Ask about this repository…')).toBeVisible()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0]?.question).toBe(question)
  })

  test('streams an answer, cites a path, and links DeepWiki', async ({ page }) => {
    const posts: Array<{ question: string; queryId?: string }> = []
    await mockAsk(page, (post) => {
      posts.push(post)
      return { status: 200, body: sseBody() }
    })

    await gotoAskable(page, GITHUB)
    await openAsk(page)
    const surface = askSurface(page)
    const composer = surface.getByLabel('Ask about this repository…')
    await composer.fill('What is this plugin?')
    await surface.getByRole('button', { name: 'Send prompt' }).click()

    await expect(surface.getByText('Reading src/index.ts')).toBeVisible()
    await expect(surface.getByText('It exposes Postgres as tools.')).toBeVisible()
    const deepWiki = surface.getByRole('link', { name: /DeepWiki/ })
    await expect(deepWiki).toHaveAttribute('href', `https://deepwiki.com/search/${QUERY_ID}`)
    expect(posts[0]?.queryId).toBeUndefined()

    await composer.fill('And the license?')
    await surface.getByRole('button', { name: 'Send prompt' }).click()
    await expect.poll(() => posts.length).toBe(2)
    expect(posts[1]?.queryId).toBe(QUERY_ID)
  })

  test('shows rate-limit copy and re-enables send', async ({ page }) => {
    await mockAsk(page, () => ({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Too many questions from this network.' },
      }),
    }))
    await gotoAskable(page, GITHUB)
    await openAsk(page)
    const surface = askSurface(page)
    await surface.getByLabel('Ask about this repository…').fill('What is this plugin?')
    await surface.getByRole('button', { name: 'Send prompt' }).click()
    await expect(surface.getByRole('alert')).toContainText('Too many questions right now')
    await expect(surface.getByRole('button', { name: 'Send prompt' })).toBeEnabled()
  })

  test('uses a right column at 1280 and a bottom sheet below lg', async ({ page }) => {
    await gotoAskable(page, GITHUB)
    await expect(page.getByRole('heading', { name: 'Install', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'README badge' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible()

    await openAsk(page)
    if (isDesktopViewport(page)) {
      const column = page.locator('#ask-panel')
      await expect(column).toBeVisible()
      expect(await column.evaluate((node) => node.tagName.toLowerCase())).toBe('aside')
      await expect(column).toHaveAttribute('aria-hidden', 'false')
      await expect(askSheet(page)).toHaveCount(0)
    } else {
      const sheet = askSheet(page)
      await expect(sheet).toBeVisible()
      expect(await sheet.evaluate((node) => node.tagName.toLowerCase())).not.toBe('aside')
    }
  })

  test('drops script tags from a streamed delta', async ({ page }) => {
    await mockAsk(page, () => ({
      status: 200,
      body: sseBody('Safe <script>alert(1)</script> text'),
    }))
    await gotoAskable(page, GITHUB)
    await openAsk(page)
    const surface = askSurface(page)
    await surface.getByLabel('Ask about this repository…').fill('Inject?')
    await surface.getByRole('button', { name: 'Send prompt' }).click()
    await expect(surface.getByText('Safe')).toBeVisible()
    await expect(surface.locator('script')).toHaveCount(0)
  })

  test('does not translate the panel when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoAskable(page, GITHUB)
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    )
    await openAsk(page)
    const panel = askSurface(page)
    await expect(panel).toBeVisible()
    for (let sample = 0; sample < 6; sample += 1) {
      const transform = await panel.evaluate((node) => getComputedStyle(node).transform)
      expect(
        transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)',
        `sample ${sample}: panel was displaced (${transform})`,
      ).toBe(true)
      await page.waitForTimeout(80)
    }
  })
})
