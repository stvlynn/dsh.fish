import { devices, type Project } from '@playwright/test'

/**
 * Device projects the plugin readme is asserted against.
 *
 * Names are Playwright's catalogue entries so each run gets the real CSS
 * pixel viewport (chrome excluded), device pixel ratio and touch flag.
 * The set is a spread of widths, not a tour of every SKU: 320 / 360 / 375 /
 * 412 / 430 / 768 covers the phones and the small tablet the layout actually
 * changes between.
 */
const PRESET_NAMES = [
  'iPhone SE',
  'iPhone SE (3rd gen)',
  'Galaxy S8',
  'Pixel 7',
  'iPhone 14 Pro Max',
  'iPad Mini',
] as const

/** Projects whose first-fold screenshot is stored as a visual baseline. */
export const SCREENSHOT_DEVICES = new Set<string>(['iPhone SE (3rd gen)', 'Pixel 7'])

export function mobileProjects(): Project[] {
  return PRESET_NAMES.map((name) => {
    const device = devices[name]
    if (device === undefined) {
      throw new Error(`Playwright has no device preset named ${name}`)
    }
    return {
      name,
      // The other suites declare their own viewport, and each needs exactly one.
      testIgnore: /(catalog-og|catalog-pagination|icons|community-toasts|artifact-ask|docs|blog|install-panel)\//,
      use: { ...device, defaultBrowserType: 'chromium' },
    }
  })
}
