import { expect, test, type APIResponse } from '@playwright/test'
import { KITCHEN_SINK_ARTIFACT_ID } from '../lib/kitchen-sink-readme.ts'
import { E2E_ORIGIN } from '../lib/origin.ts'

/**
 * llms.txt v2 through the real Worker: the three overviews, `.md` aliases,
 * covering `describedby` headers, and that every markdown link in the indexes
 * is fetchable. Serialisers are unit-tested; this is the route table, the
 * Fumadocs nav, and the Worker entry agreeing.
 */

const KINDS = ['bundle', 'profile', 'skill', 'mcp-server', 'agent-preset', 'hook-bridge'] as const

function header(response: APIResponse, name: string): string {
  return (
    response
      .headersArray()
      .filter((entry) => entry.name.toLowerCase() === name.toLowerCase())
      .map((entry) => entry.value)
      .join(', ') ||
    response.headers()[name.toLowerCase()] ||
    ''
  )
}

function hrefs(body: string): string[] {
  return [...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]!)
}

function hubPath(href: string): string | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  if (url.pathname.includes('{')) return undefined
  return url.pathname
}

test.describe('llms.txt for agents', () => {
  test('/llms.txt is a v2 overview that points at docs and the API, not the catalog', async ({
    request,
  }) => {
    const response = await request.get('/llms.txt')
    expect(response.ok()).toBeTruthy()
    expect(header(response, 'content-type')).toContain('text/markdown')
    expect(header(response, 'cache-control')).toContain('max-age=86400')

    const body = await response.text()
    const lines = body.split('\n')
    expect(lines[0]).toBe('# dsh.fish')
    expect(lines[1]?.startsWith('> ')).toBe(true)
    expect(body).toContain('/docs/llms.txt')
    expect(body).toContain('/openapi.json')
    expect(body).toContain('/api/v1/catalog/snapshot')
    expect(body).toContain('/docs/developers')
    expect(body).toContain('dsh.fish developer resources')
    expect(body).not.toMatch(/\/a\/[a-z0-9]+/)
    for (const kind of KINDS) {
      expect(body).toContain(`/kind/${kind}.md`)
    }
  })

  test('/docs/llms.txt is generated from the docs tree and every .md link resolves', async ({
    request,
  }) => {
    const response = await request.get('/docs/llms.txt')
    expect(response.ok()).toBeTruthy()
    expect(header(response, 'content-type')).toContain('text/markdown')

    const body = await response.text()
    expect(body.startsWith('# dsh.fish documentation')).toBe(true)
    expect(body).toContain('/docs/cli.md')
    expect(body).toContain('/docs/index.md')
    expect(body).toContain('/docs/llms-full.txt')

    const paths = hrefs(body)
      .map(hubPath)
      .filter((path): path is string => path !== undefined && path.endsWith('.md'))
    expect(paths.length).toBeGreaterThan(10)

    for (const path of paths) {
      const page = await request.get(path)
      expect(page.ok(), path).toBeTruthy()
      expect(header(page, 'content-type'), path).toContain('text/markdown')
    }
  })

  test('/docs/llms-full.txt concatenates the English guides', async ({ request }) => {
    const response = await request.get('/docs/llms-full.txt')
    expect(response.ok()).toBeTruthy()
    expect(header(response, 'content-type')).toContain('text/markdown')
    const body = await response.text()
    expect(body).toContain('npx @dsh-fish/cli')
    expect(body).toContain('/docs/llms.txt')
  })

  test('.md aliases serve markdown without Accept, HTML URLs still need it', async ({
    request,
  }) => {
    const aliased = await request.get('/docs/cli.md')
    expect(aliased.ok()).toBeTruthy()
    expect(header(aliased, 'content-type')).toContain('text/markdown')
    expect(await aliased.text()).toContain('npx @dsh-fish/cli')

    const html = await request.get('/docs/cli', { headers: { accept: 'text/html' } })
    expect(html.ok()).toBeTruthy()
    expect(header(html, 'content-type')).toContain('text/html')

    const negotiated = await request.get('/docs/cli', {
      headers: { accept: 'text/markdown' },
    })
    expect(header(negotiated, 'content-type')).toContain('text/markdown')

    const home = await request.get('/index.md')
    expect(home.ok()).toBeTruthy()
    expect(header(home, 'content-type')).toContain('text/markdown')

    const artifact = await request.get(`/a/${KITCHEN_SINK_ARTIFACT_ID}.md`)
    expect(artifact.ok()).toBeTruthy()
    expect(await artifact.text()).toContain('# Postgres MCP')

    const localized = await request.get('/ja/docs/cli.md')
    expect(localized.ok()).toBeTruthy()
    expect(header(localized, 'content-type')).toContain('text/markdown')
  })

  test('HTML and markdown responses advertise the covering llms.txt', async ({ request }) => {
    const browse = await request.get('/browse', { headers: { accept: 'text/html' } })
    const browseLinks = header(browse, 'link')
    expect(browseLinks).toContain('</llms.txt>; rel="describedby"; type="text/markdown"')
    expect(browseLinks).toContain(
      `<${E2E_ORIGIN}/browse.md>; rel="alternate"; type="text/markdown"`,
    )

    const docs = await request.get('/docs/cli', { headers: { accept: 'text/html' } })
    const docsLinks = header(docs, 'link')
    expect(docsLinks).toContain('</docs/llms.txt>; rel="describedby"; type="text/markdown"')
    expect(docsLinks).toContain(
      `<${E2E_ORIGIN}/docs/cli.md>; rel="alternate"; type="text/markdown"`,
    )

    const markdown = await request.get('/docs/cli.md')
    expect(header(markdown, 'link')).toContain(
      '</docs/llms.txt>; rel="describedby"; type="text/markdown"',
    )
    expect(header(markdown, 'link')).not.toContain('rel="alternate"')
  })

  test('indexable pages repeat describedby and the markdown alias in the head', async ({
    page,
  }) => {
    await page.goto('/docs/cli', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('link[rel="describedby"][type="text/markdown"]')).toHaveAttribute(
      'href',
      /\/docs\/llms\.txt$/,
    )
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
      'href',
      /\/docs\/cli\.md$/,
    )
  })

  test('robots.txt and the api-catalog name /llms.txt', async ({ request }) => {
    const robots = await request.get('/robots.txt')
    expect(await robots.text()).toContain('/llms.txt')

    const catalog = await request.get('/.well-known/api-catalog')
    expect(catalog.ok()).toBeTruthy()
    const body = (await catalog.json()) as {
      linkset: { describedby?: { href: string; type: string }[] }[]
    }
    const origin = body.linkset.find((entry) =>
      (entry.describedby ?? []).some((link) => link.href.endsWith('/llms.txt')),
    )
    expect(origin?.describedby?.some((link) => link.type === 'text/markdown')).toBe(true)
  })

  test('a language cookie does not redirect .txt or .md files', async ({ request }) => {
    const headers = { cookie: 'dsh_locale=ja', accept: 'text/html' }
    for (const path of ['/llms.txt', '/docs/llms.txt', '/docs/cli.md', '/index.md']) {
      const response = await request.get(path, { headers, maxRedirects: 0 })
      expect(response.status(), path).toBe(200)
    }
  })
})
