import { expect, type Page } from '@playwright/test'

/**
 * Wait until the client has taken over and its effects have run.
 *
 * `domcontentloaded` returns while the page is still the server's HTML, and
 * controls that only know their state after an effect (theme, menu, the ask
 * column vs sheet) still belong to that first paint. The account slot is the
 * signal: it renders a blank placeholder until the session resolves in the
 * browser, so a sign-in link in the bar means hydration is done.
 */
export async function awaitHydration(page: Page): Promise<void> {
  await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible()
}
