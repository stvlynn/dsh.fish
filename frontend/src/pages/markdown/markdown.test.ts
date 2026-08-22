import { describe, expect, it } from 'vitest'
import type { Container } from '@dsh-fish/backend/infrastructure/container.js'
import type { ArtifactDetail, InstallPlanDto } from '@/entities/artifact/model/types'
import { mockArtifact } from '@/entities/artifact/model/artifact.fixture'
import { prefersMarkdown, estimateTokens } from './negotiate'
import { artifactMarkdown, listingItemMarkdown } from './artifact'
import { maybeMarkdownResponse, supportsMarkdownNegotiation } from './handler'

const ORIGIN = 'https://dsh.fish'

const DETAIL: ArtifactDetail = {
  ...mockArtifact(),
  payload: { kind: 'bundle', patch: {} } as never,
  availableLocales: ['en'],
  readmeMarkdown: '# Hello\n\nUse it well.',
  publishedAt: '2026-01-01T00:00:00.000Z',
  ask: { available: true, repoName: 'acme/dsh-hello' },
}

const PLAN: InstallPlanDto = {
  artifactId: 'dsh-hello',
  kind: 'bundle',
  profile: 'web',
  steps: [],
  manualCommands: ['dsh plugin --profile web add github:acme/dsh-hello'],
  warningKeys: [],
}

describe('prefersMarkdown', () => {
  it('is false without an Accept header and for a browser Accept', () => {
    expect(prefersMarkdown(null)).toBe(false)
    expect(prefersMarkdown('text/html,application/xhtml+xml,image/avif,*/*;q=0.8')).toBe(false)
  })

  it('is true when text/markdown is acceptable', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
    expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true)
  })

  it('respects q-values', () => {
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false)
    expect(prefersMarkdown('text/html;q=1, text/markdown;q=0.5')).toBe(false)
  })
})

describe('estimateTokens', () => {
  it('estimates four characters per token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('artifactMarkdown', () => {
  it('emits frontmatter, metadata, the install command, the readme and JSON-LD', () => {
    const markdown = artifactMarkdown(ORIGIN, 'en', DETAIL, PLAN)

    expect(markdown).toContain('title: @acme/dsh-hello')
    expect(markdown).toContain(`image: ${ORIGIN}/a/dsh-hello/og.png`)
    expect(markdown).toContain('# @acme/dsh-hello')
    expect(markdown).toContain('https://github.com/acme/dsh-hello')
    expect(markdown).toContain('npx @dsh-fish/cli add dsh-hello')
    expect(markdown).toContain('dsh plugin --profile web add github:acme/dsh-hello')
    expect(markdown).toContain('# Hello')
    expect(markdown).toContain('```json')
    expect(markdown).toContain('"@context": "https://schema.org"')
  })
})

describe('listingItemMarkdown', () => {
  it('links the name to the localized plugin page', () => {
    expect(listingItemMarkdown(ORIGIN, 'en', mockArtifact())).toBe(
      '- [@acme/dsh-hello](https://dsh.fish/a/dsh-hello) — A bundle.',
    )
    expect(listingItemMarkdown(ORIGIN, 'ja', mockArtifact())).toContain(
      'https://dsh.fish/ja/a/dsh-hello',
    )
  })
})

describe('maybeMarkdownResponse', () => {
  function stubContainer(): Container {
    return {
      config: { baseUrl: ORIGIN },
      useCases: {
        getArtifactDetail: { execute: async () => DETAIL },
        resolveInstallPlan: { execute: async () => PLAN },
        searchArtifacts: {
          execute: async () => ({
            items: [mockArtifact()],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        },
      },
    } as unknown as Container
  }

  function request(path: string, accept?: string): Request {
    return new Request(`${ORIGIN}${path}`, {
      headers: accept === undefined ? {} : { accept },
    })
  }

  it('returns null for a browser request', async () => {
    const response = await maybeMarkdownResponse(
      request('/a/dsh-hello', 'text/html'),
      stubContainer(),
    )
    expect(response).toBeNull()
  })

  it('serves a plugin page as markdown with the negotiation headers', async () => {
    const response = await maybeMarkdownResponse(
      request('/a/dsh-hello', 'text/markdown'),
      stubContainer(),
    )

    expect(response).not.toBeNull()
    expect(response!.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response!.headers.get('vary')).toBe('accept')
    expect(Number(response!.headers.get('x-markdown-tokens'))).toBeGreaterThan(0)
    expect(await response!.text()).toContain('# @acme/dsh-hello')
  })

  it('serves localized and listing paths as markdown', async () => {
    const localized = await maybeMarkdownResponse(
      request('/zh-CN/a/dsh-hello', 'text/markdown'),
      stubContainer(),
    )
    expect(localized).not.toBeNull()

    const browse = await maybeMarkdownResponse(
      request('/browse?q=mcp', 'text/markdown'),
      stubContainer(),
    )
    expect(browse).not.toBeNull()
    expect(await browse!.text()).toContain('- [@acme/dsh-hello]')

    const kind = await maybeMarkdownResponse(
      request('/kind/bundle', 'text/markdown'),
      stubContainer(),
    )
    expect(kind).not.toBeNull()

    const docs = await maybeMarkdownResponse(request('/docs/cli', 'text/markdown'), stubContainer())
    expect(docs).not.toBeNull()
    expect(await docs!.text()).toContain('npx @dsh-fish/cli')

    const localizedDocs = await maybeMarkdownResponse(
      request('/zh-CN/docs/quickstart', 'text/markdown'),
      stubContainer(),
    )
    expect(localizedDocs).not.toBeNull()
    expect(await localizedDocs!.text()).toContain('启动 Web UI')
  })

  it('serves v2 .md aliases without an Accept header', async () => {
    const docs = await maybeMarkdownResponse(request('/docs/cli.md'), stubContainer())
    expect(docs).not.toBeNull()
    expect(docs!.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await docs!.text()).toContain('npx @dsh-fish/cli')

    const home = await maybeMarkdownResponse(request('/index.md'), stubContainer())
    expect(home).not.toBeNull()

    const docsIndex = await maybeMarkdownResponse(request('/docs/index.md'), stubContainer())
    expect(docsIndex).not.toBeNull()

    const artifact = await maybeMarkdownResponse(request('/a/dsh-hello.md'), stubContainer())
    expect(artifact).not.toBeNull()
    expect(await artifact!.text()).toContain('# @acme/dsh-hello')

    const localized = await maybeMarkdownResponse(request('/ja/docs/cli.md'), stubContainer())
    expect(localized).not.toBeNull()
  })

  it('still requires Accept on the HTML URL', async () => {
    expect(await maybeMarkdownResponse(request('/docs/cli'), stubContainer())).toBeNull()
    expect(await maybeMarkdownResponse(request('/a/dsh-hello'), stubContainer())).toBeNull()
  })

  it('falls through for unknown paths and unknown artifacts', async () => {
    const container = stubContainer()
    expect(await maybeMarkdownResponse(request('/submit', 'text/markdown'), container)).toBeNull()
    expect(
      await maybeMarkdownResponse(request('/kind/nope', 'text/markdown'), container),
    ).toBeNull()

    const missing = {
      ...container,
      useCases: {
        ...container.useCases,
        getArtifactDetail: {
          execute: async () => Promise.reject(new Error('not found')),
        },
      },
    } as unknown as Container
    expect(await maybeMarkdownResponse(request('/a/missing', 'text/markdown'), missing)).toBeNull()
  })
})

describe('supportsMarkdownNegotiation', () => {
  it('covers the home, listing and artifact paths, localized or not', () => {
    expect(supportsMarkdownNegotiation('/')).toBe(true)
    expect(supportsMarkdownNegotiation('/ja')).toBe(true)
    expect(supportsMarkdownNegotiation('/browse')).toBe(true)
    expect(supportsMarkdownNegotiation('/zh-CN/browse')).toBe(true)
    expect(supportsMarkdownNegotiation('/kind/bundle')).toBe(true)
    expect(supportsMarkdownNegotiation('/category/coding')).toBe(true)
    expect(supportsMarkdownNegotiation('/a/dsh-hello')).toBe(true)
  })

  it('rejects UI-only pages and unknown taxonomy values', () => {
    expect(supportsMarkdownNegotiation('/submit')).toBe(false)
    expect(supportsMarkdownNegotiation('/docs/search')).toBe(false)
    expect(supportsMarkdownNegotiation('/kind/nope')).toBe(false)
    expect(supportsMarkdownNegotiation('/category/nope')).toBe(false)
  })

  it('covers product docs, localized or not', () => {
    expect(supportsMarkdownNegotiation('/docs')).toBe(true)
    expect(supportsMarkdownNegotiation('/ja/docs')).toBe(true)
    expect(supportsMarkdownNegotiation('/docs/cli')).toBe(true)
    expect(supportsMarkdownNegotiation('/zh-CN/docs/publish/hook-bridge')).toBe(true)
  })
})
