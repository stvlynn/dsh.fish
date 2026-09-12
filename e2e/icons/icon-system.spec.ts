import { expect, test } from '@playwright/test'
import { ARTIFACT_KINDS } from '../../backend/src/domain/artifact/artifact-kind.ts'
import { CATEGORIES } from '../../backend/src/domain/artifact/category.ts'
import { auditIcons, awaitHydration, hitArea, markOf, marksIn, stubClipboard } from '../lib/icons.ts'

/**
 * The icon system, against the seeded local catalog.
 *
 * The unit tests prove the maps are complete and that a component renders the
 * mark it was asked for. What only a browser can show is whether the system holds
 * across a whole document: that one library reached the page, that a selected
 * state changes the drawing and not merely the colour, and that the same fact
 * wears the same mark in the three or four places a reader meets it.
 *
 * Marks are compared as path data read out of the served document, never against
 * a path this test knows. A test that hard-coded Phosphor's geometry would fail on
 * a library upgrade that changed nothing a reader can see.
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'browse', path: '/browse' },
  { name: 'kind collection', path: '/kind/skill' },
  { name: 'category collection', path: '/category/ui' },
  { name: 'plugin detail', path: '/a/dsh-postgres-mcp' },
  { name: 'docs', path: '/docs' },
  { name: 'submit', path: '/submit' },
  { name: 'sign in', path: '/sign-in' },
] as const

test.describe('one icon set, one contract', () => {
  for (const { name, path } of PAGES) {
    test(`${name} draws every mark on the same grid, in currentColor, unannounced`, async ({
      page,
    }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      const audit = await auditIcons(page)

      expect(audit.total, `${name} should paint icons`).toBeGreaterThan(0)
      // A glyph from a second library, an asset with a baked colour, or a mark a
      // screen reader would read out beside the label it duplicates.
      expect(audit.offGrid, `${name}: not on Phosphor's grid`).toEqual([])
      expect(audit.hardCoded, `${name}: colour is not CSS's to set`).toEqual([])
      expect(audit.announced, `${name}: announced beside its own label`).toEqual([])
    })
  }
})

test.describe('destination marks', () => {
  test('every navigation link carries one, in the bar and in the footer', async ({ page }) => {
    await page.goto('/browse', { waitUntil: 'domcontentloaded' })

    const bar = page.locator('header nav').first()
    await expect(bar.getByRole('link')).toHaveCount(4)
    for (const label of ['Browse', 'Docs', 'Blog', 'Submit']) {
      await expect(bar.getByRole('link', { name: label }).locator('svg')).toHaveCount(1)
    }

    const siteNav = page.getByRole('navigation', { name: 'dsh.fish' })
    for (const label of ['Browse', 'Docs', 'Blog', 'Submit', 'GitHub', 'Discord', 'DeepSeek Harness']) {
      await expect(siteNav.getByRole('link', { name: label }).locator('svg')).toHaveCount(1)
    }
  })

  test('the source and the community are marked in the bar and leave the tab behind', async ({
    page,
  }) => {
    await page.goto('/browse', { waitUntil: 'domcontentloaded' })

    const header = page.locator('header')
    const github = header.getByRole('link', { name: 'GitHub' })
    const discord = header.getByRole('link', { name: 'Discord' })

    for (const link of [github, discord]) {
      await expect(link.locator('svg')).toHaveCount(1)
      await expect(link).toHaveAttribute('target', '_blank')
    }

    // Icon-only in the bar, so the two marks carry the destination on their own.
    expect(await markOf(github)).not.toEqual(await markOf(discord))
  })

  test('the current destination fills its mark rather than only recolouring it', async ({
    page,
  }) => {
    const browseLink = (name: string) =>
      page.locator('header nav').first().getByRole('link', { name })

    await page.goto('/browse', { waitUntil: 'domcontentloaded' })
    await expect(browseLink('Browse')).toHaveAttribute('aria-current', 'page')
    const selected = await markOf(browseLink('Browse'))

    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    await expect(browseLink('Browse')).not.toHaveAttribute('aria-current', 'page')
    const idle = await markOf(browseLink('Browse'))

    // Colour alone would leave the state invisible to a reader who cannot see it.
    expect(selected).not.toEqual(idle)
    // And it is still the same destination, so the two share a silhouette rather
    // than being two unrelated glyphs.
    expect(selected).not.toHaveLength(0)
    expect(idle).not.toHaveLength(0)
  })
})

test.describe('the catalog taxonomy', () => {
  test('the footer marks every kind and every category the taxonomy defines', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const kinds = page.getByRole('navigation', { name: 'Type' })
    const categories = page.getByRole('navigation', { name: 'Category' })

    // The footer is the one page that links the whole taxonomy, including the
    // categories no seeded row happens to use.
    await expect(kinds.getByRole('link')).toHaveCount(ARTIFACT_KINDS.length)
    await expect(kinds.locator('a svg')).toHaveCount(ARTIFACT_KINDS.length)
    await expect(categories.getByRole('link')).toHaveCount(CATEGORIES.length)
    await expect(categories.locator('a svg')).toHaveCount(CATEGORIES.length)

    const kindMarks = await marksIn(kinds)
    expect(new Set(kindMarks).size, 'each kind needs its own mark').toBe(ARTIFACT_KINDS.length)

    const categoryMarks = await marksIn(categories)
    expect(new Set(categoryMarks).size, 'each category needs its own mark').toBe(CATEGORIES.length)
    for (const mark of categoryMarks) {
      expect(kindMarks, 'a mark cannot mean both a kind and a category').not.toContain(mark)
    }
  })

  test('a kind wears the same mark in the filter rail and on the rows it selects', async ({
    page,
  }) => {
    await page.goto('/browse', { waitUntil: 'domcontentloaded' })

    const rail = page.getByRole('link', { name: /^Bundle\b/ }).first()
    const chip = page
      .getByRole('article')
      .filter({ hasText: 'Postgres MCP' })
      .getByText('Bundle')

    // Learning a mark once in the rail has to be worth something in the grid.
    expect(await markOf(chip)).toEqual(await markOf(rail))
  })

  test('a collection heading wears the mark of the kind it collects', async ({ page }) => {
    await page.goto('/kind/skill', { waitUntil: 'domcontentloaded' })

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading.locator('svg')).toHaveCount(1)

    const chip = page.getByRole('article').first().getByText('Skill')
    expect(await markOf(chip)).toEqual(await markOf(heading))
  })

  test('a plugin page marks its kind in the trail, the chip and each category', async ({ page }) => {
    await page.goto('/a/dsh-postgres-mcp', { waitUntil: 'domcontentloaded' })

    const trail = page.getByRole('navigation', { name: 'Browse' }).first()
    // A caret, not a slash: the separator says "one step further in".
    await expect(trail.locator('svg')).toHaveCount(3)
    await expect(trail).not.toContainText('/')

    const pill = page.locator('article > header').getByRole('link', { name: 'Docs' })
    await expect(pill.locator('svg')).toHaveCount(1)
    // The pill on the page and the link in the footer name one category, so they
    // cannot disagree about its mark.
    const footerCategory = page
      .getByRole('navigation', { name: 'Category' })
      .getByRole('link', { name: 'Docs' })
    expect(await markOf(pill)).toEqual(await markOf(footerCategory))
  })
})

test.describe('facts about a row', () => {
  test('a verified row is sealed, an unverified one is not', async ({ page }) => {
    await page.goto('/browse', { waitUntil: 'domcontentloaded' })

    const verified = page.getByRole('article').filter({ hasText: '@turtle/dsh-turtle-ui' })
    await expect(verified.getByText('Verified')).toBeVisible()

    const unverified = page.getByRole('article').filter({ hasText: 'claude-code-hooks' })
    await expect(unverified.getByText('Verified')).toHaveCount(0)

    // The filter that selects verified rows uses the badge's own mark, filled,
    // so the control and the thing it selects are recognisably the same fact.
    const filter = page.getByText('Verified only')
    expect(await markOf(filter)).toEqual(await markOf(verified.getByText('Verified')))
  })

  test('a deprecated plugin is warned about beside its kind', async ({ page }) => {
    // Its own page, not a listing: a deprecated row is filtered out of search, so
    // the only place a reader meets the badge is the page they were linked to.
    await page.goto('/a/dsh-legacy-shim', { waitUntil: 'domcontentloaded' })

    const badge = page.getByText('Deprecated')
    await expect(badge).toBeVisible()
    await expect(badge.locator('svg')).toHaveCount(1)

    // Warning, not the kind's own mark: the two sit side by side and must not
    // read as one fact.
    const chip = page.locator('article > header').getByText('Bundle')
    expect(await markOf(badge)).not.toEqual(await markOf(chip))
  })

  test('a counted fact wears the same mark on a card and on the plugin page', async ({ page }) => {
    await page.goto('/browse', { waitUntil: 'domcontentloaded' })
    const cardStars = page
      .getByRole('article')
      .filter({ hasText: 'Postgres MCP' })
      .locator('span.tabular-nums')
      .first()
    const onCard = await markOf(cardStars)

    await page.goto('/a/dsh-postgres-mcp', { waitUntil: 'domcontentloaded' })
    const detailStars = page.locator('dl dd').filter({ hasText: 'stars' })
    expect(await markOf(detailStars)).toEqual(onCard)
  })

  test('the metrics row marks every fact it lists', async ({ page }) => {
    await page.goto('/a/dsh-postgres-mcp', { waitUntil: 'domcontentloaded' })
    const metrics = page.locator('dl').first()
    // Score, installs, stars, licence and last-updated; the score always
    // renders, while downloads is zero on this row and its mark must vanish
    // with its number.
    await expect(metrics.locator('dd svg')).toHaveCount(5)
    await expect(metrics).toContainText('Apache-2.0')
    await expect(metrics).not.toContainText('downloads')
  })
})

test.describe('controls', () => {
  test('both install routes are marked, and the chosen one is filled', async ({ page }) => {
    await page.goto('/a/dsh-postgres-mcp', { waitUntil: 'domcontentloaded' })
    await awaitHydration(page)

    const cli = page.getByRole('tab', { name: 'Via CLI' })
    const agent = page.getByRole('tab', { name: 'Via hub plugin' })
    await expect(cli.locator('svg')).toHaveCount(1)
    await expect(agent.locator('svg')).toHaveCount(1)

    const cliSelected = await markOf(cli)
    const agentIdle = await markOf(agent)
    await expect(cli).toHaveAttribute('aria-selected', 'true')

    await agent.click()
    await expect(agent).toHaveAttribute('aria-selected', 'true')
    // Both marks change: the one that gained the state and the one that lost it.
    expect(await markOf(agent)).not.toEqual(agentIdle)
    expect(await markOf(cli)).not.toEqual(cliSelected)
  })

  test('the docs nav carries the kind marks the catalog uses', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'domcontentloaded' })
    const docsNav = page.getByRole('navigation', { name: 'Documentation menu' })
    const skill = docsNav.getByRole('link', { name: 'Skills' })
    await expect(skill.locator('svg')).toHaveCount(1)

    const footerSkill = page
      .getByRole('navigation', { name: 'Type' })
      .getByRole('link', { name: 'Skills' })
    // Same kind, so the page explaining how to publish it and the link to the
    // collection of it must be recognisably about the same thing.
    expect(await markOf(skill)).not.toHaveLength(0)
    expect(await markOf(footerSkill)).not.toHaveLength(0)
  })

  test('search and sort are marked wherever they appear', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // The field and the button that submits it.
    await expect(page.locator('form').first().locator('svg')).toHaveCount(2)

    await page.goto('/browse', { waitUntil: 'domcontentloaded' })
    const controls = page.locator('header form')
    // Search field, sort select, submit button.
    await expect(controls.locator('svg')).toHaveCount(3)

    // Sorting is not searching, so the two fields in this row do not share a mark.
    const search = await markOf(controls.locator('div').nth(0))
    const sort = await markOf(controls.locator('div').nth(1))
    expect(search).not.toEqual(sort)
  })

  test('an empty result says so, and marks it with the control that ran it', async ({ page }) => {
    await page.goto('/browse?q=zzzznothinghere', { waitUntil: 'domcontentloaded' })
    const panel = page.locator('.border-dashed')
    await expect(panel).toContainText('Nothing matches those filters yet.')
    // Its own mark, plus one on each of the two ways forward.
    await expect(panel.locator('svg')).toHaveCount(3)
    // And that mark is the search control's, so the panel reads as the outcome
    // of the field above it rather than as a decoration.
    expect(await markOf(panel)).toEqual(await markOf(page.locator('header form div').first()))
  })

  test('the copy control swaps its mark once the command is on the clipboard', async ({ page }) => {
    await stubClipboard(page)
    await page.goto('/a/dsh-postgres-mcp', { waitUntil: 'domcontentloaded' })
    await awaitHydration(page)

    const copy = page.getByRole('button', { name: 'Copy' }).first()
    const idle = await markOf(copy)
    await copy.click()

    // The command really was handed over, and only then does the mark change.
    expect(await page.evaluate(() => (window as { __copied?: string[] }).__copied)).toHaveLength(1)
    const confirmed = page.getByRole('button', { name: 'Copied' }).first()
    await expect(confirmed).toBeVisible()
    // Polled, not read once: the swap keeps both glyphs mounted while the
    // outgoing one blurs away, which is the point of doing it that way.
    await expect.poll(async () => markOf(confirmed)).not.toEqual(idle)
  })
})

test.describe('icon-only controls', () => {
  test('reach 40px on a desktop pointer without overlapping each other', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const language = page.getByRole('button', { name: 'Language' })
    const theme = page.getByRole('button', { name: /^Switch to/ })

    for (const control of [language, theme]) {
      const area = await hitArea(control)
      expect(area.width).toBeGreaterThanOrEqual(40)
      expect(area.height).toBeGreaterThanOrEqual(40)
    }

    // Two 40px targets whose centres are closer than 40px apart would steal each
    // other's clicks.
    const left = await language.boundingBox()
    const right = await theme.boundingBox()
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    const gap = Math.abs(right!.x + right!.width / 2 - (left!.x + left!.width / 2))
    expect(gap).toBeGreaterThanOrEqual(40)
  })

  test('the theme toggle swaps its mark and says which way it now goes', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await awaitHydration(page)

    const toggle = page.getByRole('button', { name: /^Switch to/ })
    const before = await toggle.getAttribute('aria-label')
    const idle = await markOf(toggle)

    await toggle.click()
    await expect(toggle).not.toHaveAttribute('aria-label', before!)
    // Motion is never the only channel: the label changes with the glyph.
    await expect.poll(async () => markOf(toggle)).not.toEqual(idle)
  })
})
