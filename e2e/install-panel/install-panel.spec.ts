import { expect, test, type Page } from '@playwright/test'
import { COMMUNITY_TOAST_IDS } from '../../frontend/src/widgets/community-toasts/model/dismissal.ts'
import { awaitHydration } from '../lib/hydration'
import {
  GIT_PIN,
  INSTALL_TARGET_FIXTURES,
  RELEASE_TARBALL_SPEC,
} from '../lib/install-target-fixtures'
import { E2E_ORIGIN } from '../lib/origin'

/**
 * The install panel is the reason the site exists: the command a reader copies
 * must be the same spec `buildInstallPlan` chose. These pages are seeded with
 * the three catalog-time targets (verified npm, Release tarball, pinned git)
 * plus an npm-origin row from the shared seed.
 */

async function openArtifact(page: Page, id: string, profile?: string): Promise<void> {
  await page.context().addCookies([
    { name: 'community', value: COMMUNITY_TOAST_IDS.join('.'), url: E2E_ORIGIN },
  ])
  const query = profile === undefined ? '' : `?profile=${profile}`
  await page.goto(`/a/${id}${query}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Install', level: 2 }).waitFor()
  await awaitHydration(page)
}

function installSection(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Install', level: 2 }) })
}

test.describe('install panel on the web profile', () => {
  test('pins an npm-origin bundle to name@version', async ({ page }) => {
    await openArtifact(page, 'dsh-turtle-ui')
    const section = installSection(page)

    await expect(section.getByText('npx @dsh-fish/cli add dsh-turtle-ui --profile web')).toBeVisible()
    await expect(
      section.getByText('dsh plugin --profile web add @turtle/dsh-turtle-ui@0.4.2'),
    ).toBeVisible()
    await expect(section.getByText('web', { exact: true })).toBeVisible()
    await expect(section.getByText(/builds from source/i)).toHaveCount(0)
  })

  test('uses a verified npm name for a GitHub-indexed package, not a git spec', async ({
    page,
  }) => {
    await openArtifact(page, INSTALL_TARGET_FIXTURES.verifiedNpm)
    const section = installSection(page)

    await expect(
      section.getByText(`npx @dsh-fish/cli add ${INSTALL_TARGET_FIXTURES.verifiedNpm} --profile web`),
    ).toBeVisible()
    await expect(section.getByText('dsh plugin --profile web add dsh-context')).toBeVisible()
    await expect(section.getByText(/github:bowenliang123\/dsh-context/)).toHaveCount(0)
    await expect(section.getByText(/builds from source/i)).toHaveCount(0)
  })

  test('does not treat a legal display name as an npm package', async ({ page }) => {
    await openArtifact(page, INSTALL_TARGET_FIXTURES.unpublishedGit)
    const section = installSection(page)
    const gitSpec = `github:acme/dsh-inline-comments#${GIT_PIN}`

    await expect(section.getByText(`dsh plugin --profile web add ${gitSpec}`)).toBeVisible()
    await expect(section.getByText('dsh plugin --profile web add dsh-inline-comments', { exact: true })).toHaveCount(
      0,
    )
    await expect(section.getByText(/builds from source/i)).toBeVisible()
  })

  test('offers a same-repo Release tarball instead of a git checkout', async ({ page }) => {
    await openArtifact(page, INSTALL_TARGET_FIXTURES.releaseTarball)
    const section = installSection(page)

    await expect(section.getByText(`dsh plugin --profile web add ${RELEASE_TARBALL_SPEC}`)).toBeVisible()
    await expect(section.getByText(/github:acme\/prebuilt/)).toHaveCount(0)
    await expect(section.getByText(/builds from source/i)).toHaveCount(0)
  })

  test('rewrites the copied command when the page previews another profile', async ({
    page,
  }) => {
    await openArtifact(page, INSTALL_TARGET_FIXTURES.verifiedNpm, 'local-dsh')
    const section = installSection(page)

    await expect(
      section.getByText(
        `npx @dsh-fish/cli add ${INSTALL_TARGET_FIXTURES.verifiedNpm} --profile local-dsh`,
      ),
    ).toBeVisible()
    await expect(section.getByText('dsh plugin --profile local-dsh add dsh-context')).toBeVisible()
    await expect(section.locator('code').filter({ hasText: 'local-dsh' })).toBeVisible()
  })

  test('the plugin tab still points at the hub; the CLI tab keeps the plan spec', async ({
    page,
  }) => {
    await openArtifact(page, INSTALL_TARGET_FIXTURES.verifiedNpm)
    const section = installSection(page)
    const pluginTab = section.getByRole('tab', { name: /hub plugin/i })
    const cliTab = section.getByRole('tab', { name: /cli/i })

    await pluginTab.click()
    await expect(pluginTab).toHaveAttribute('aria-selected', 'true')
    await expect(section.locator('pre', { hasText: 'dsh plugin --profile web add @dsh-fish/hub' })).toBeVisible()
    await expect(
      section.getByText(`install ${INSTALL_TARGET_FIXTURES.verifiedNpm} from the hub`),
    ).toBeVisible()

    await cliTab.click()
    await expect(cliTab).toHaveAttribute('aria-selected', 'true')
    await expect(section.locator('pre', { hasText: 'dsh plugin --profile web add dsh-context' })).toBeVisible()
  })
})

test.describe('install-plan API', () => {
  test('the public plan matches the command on the page', async ({ request }) => {
    const web = await request.get(
      `/api/v1/artifacts/${INSTALL_TARGET_FIXTURES.verifiedNpm}/install-plan?profile=web`,
    )
    expect(web.ok()).toBe(true)
    const body = (await web.json()) as {
      profile: string
      steps: { type: string; spec: string; requiresBuildAllowance: boolean }[]
      manualCommands: string[]
      warningKeys: string[]
    }

    expect(body.profile).toBe('web')
    expect(body.steps).toEqual([
      {
        type: 'add-package',
        spec: 'dsh-context',
        requiresBuildAllowance: false,
        profile: 'web',
      },
    ])
    expect(body.manualCommands).toContain('dsh plugin --profile web add dsh-context')
    expect(body.warningKeys).not.toContain('install.warning.buildAllowance')

    const unpublished = await request.get(
      `/api/v1/artifacts/${INSTALL_TARGET_FIXTURES.unpublishedGit}/install-plan`,
    )
    const unpublishedBody = (await unpublished.json()) as {
      steps: { spec: string; requiresBuildAllowance: boolean }[]
    }
    expect(unpublishedBody.steps[0]).toMatchObject({
      spec: `github:acme/dsh-inline-comments#${GIT_PIN}`,
      requiresBuildAllowance: true,
    })
  })
})
