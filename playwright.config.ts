import { defineConfig, devices } from '@playwright/test'
import { mobileProjects } from './e2e/lib/devices'
import { E2E_ORIGIN } from './e2e/lib/origin'

const baseURL = E2E_ORIGIN

/**
 * End-to-end coverage.
 *
 * Mobile markdown rendering on the plugin detail page, the catalog-card Social
 * preview treatment, and the icon system. One Chromium run, many device projects
 * for the readme: overflow, wrapping and stacking are resolution-dependent, and a
 * single "phone" viewport would miss the 360px Android and 430px iPhone Max cases.
 *
 * The other suites each need one viewport, not a matrix. The OG-card project is a
 * fixture page. The icon suite is split by pointer rather than by width: most of it
 * needs the desktop bar, which is hidden below `md`, while the menu toggle and the
 * 44px hit areas only exist under a coarse pointer. The community stack is fixed to
 * one corner at one width, so a matrix would assert the same thing six times.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `node --experimental-strip-types e2e/dev-server.ts`,
    url: `${baseURL}/a/dsh-postgres-mcp`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    cwd: '.',
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    ...mobileProjects(),
    {
      name: 'catalog-pagination',
      testMatch: /catalog-pagination\/.*\.spec\.ts/,
      use: {
        viewport: { width: 1280, height: 900 },
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'catalog-og',
      testMatch: /catalog-og\/.*\.spec\.ts/,
      use: {
        viewport: { width: 780, height: 520 },
        deviceScaleFactor: 2,
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'icons',
      testMatch: /icons\/icon-system\.spec\.ts/,
      use: {
        viewport: { width: 1280, height: 900 },
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'icons-touch',
      testMatch: /icons\/icon-touch\.spec\.ts/,
      use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'community-toasts',
      testMatch: /community-toasts\/.*\.spec\.ts/,
      use: {
        viewport: { width: 1280, height: 900 },
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'artifact-ask',
      testMatch: /artifact-ask\/.*\.spec\.ts/,
      use: {
        viewport: { width: 1280, height: 900 },
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'docs',
      testMatch: /docs\/(docs-section|llms-txt)\.spec\.ts/,
      use: {
        viewport: { width: 1280, height: 900 },
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'artifact-ask-touch',
      testMatch: /artifact-ask\/.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'docs-mobile',
      testMatch: /docs\/docs-mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' },
    },
  ],
})
