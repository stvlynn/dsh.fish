import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Icon helpers for the end-to-end suite.
 *
 * Nothing here imports the icon library. A test that asked Phosphor which paths
 * it draws would be asserting that the library agrees with itself; these helpers
 * read the mark out of the served document instead, so what is checked is what a
 * browser actually painted.
 */

/**
 * The mark an element draws, as its path data.
 *
 * Two renderings of the same glyph at the same weight give the same string; the
 * same glyph at a different weight, or a different glyph, gives a different one.
 * That is enough to state every claim this suite makes about marks — that two
 * places agree, that a selected state changes the drawing, that a mark is present
 * at all — without naming a single path.
 */
export async function markOf(scope: Locator): Promise<string> {
  // `descendant-or-self`, so a caller may hand over either the element that
  // contains the mark or the mark itself.
  const svg = scope.locator('xpath=descendant-or-self::*[local-name()="svg"]').first()
  await expect(svg).toBeAttached()
  return svg.evaluate((node) =>
    Array.from(node.querySelectorAll('path, circle, rect, line, polyline'))
      .map((shape) => shape.getAttribute('d') ?? shape.outerHTML)
      .join('|'),
  )
}

/** Every mark drawn inside `scope`, in document order. */
export async function marksIn(scope: Locator): Promise<string[]> {
  const count = await scope.locator('svg').count()
  const marks: string[] = []
  for (let index = 0; index < count; index += 1) {
    marks.push(await markOf(scope.locator('svg').nth(index)))
  }
  return marks
}

export interface IconAudit {
  total: number
  offGrid: string[]
  hardCoded: string[]
  announced: string[]
}

/**
 * Audit every icon the page painted.
 *
 * Zero-sized SVGs are skipped: the popover's goo filter is a `<defs>` block with
 * `width="0"`, which is structural markup rather than an icon, and holding it to
 * the icon rules would be asserting the wrong thing about it.
 */
export async function auditIcons(page: Page): Promise<IconAudit> {
  return page.evaluate(() => {
    const audit: IconAudit = { total: 0, offGrid: [], hardCoded: [], announced: [] }
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      const box = svg.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      audit.total += 1
      const where = svg.parentElement?.tagName.toLowerCase() ?? 'svg'
      const id = `${where}.${svg.getAttribute('class') ?? ''}`.trim()
      // Phosphor's grid. A glyph from a second library would not be on it.
      if (svg.getAttribute('viewBox') !== '0 0 256 256') audit.offGrid.push(id)
      // One SVG recoloured by CSS, never a variant per state.
      if (svg.getAttribute('fill') !== 'currentColor') audit.hardCoded.push(id)
      // Every mark accompanies a label, so announcing it would say it twice.
      if (svg.getAttribute('aria-hidden') !== 'true') audit.announced.push(id)
    }
    return audit
  }) as Promise<IconAudit>
}

export { awaitHydration } from './hydration.ts'

/**
 * Make the clipboard succeed, whatever the browser build supports.
 *
 * Headless Chromium's clipboard is not reliably available, and a copy control that
 * silently did nothing would leave this suite asserting the failure path. What is
 * under test is the mark that swaps once the write succeeds, so the write itself is
 * stubbed and the text it received is recorded for the test to check.
 */
export async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const written: string[] = []
    Object.defineProperty(window, '__copied', { get: () => written })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    })
  })
}

/** The rendered size of a control's extended hit area, in CSS pixels. */
export async function hitArea(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate((node) => {
    const pseudo = getComputedStyle(node, '::after')
    const box = node.getBoundingClientRect()
    return {
      width: Math.max(parseFloat(pseudo.width) || 0, box.width),
      height: Math.max(parseFloat(pseudo.height) || 0, box.height),
    }
  })
}
