import { describe, expect, it } from 'vitest'
import { LOCALE_CODES } from '@/shared/config/i18n'
import { productDocsLocales, productDocsMarkdown, productDocsPaths, supportsProductDocsMarkdown } from './raw'

const DOC_PATHS = [
  '/docs',
  '/docs/quickstart',
  '/docs/concepts',
  '/docs/plugins',
  '/docs/hub',
  '/docs/cli',
  '/docs/develop/first-plugin',
  '/docs/develop/tool',
  '/docs/develop/configuration',
  '/docs/publish/skill',
  '/docs/publish/mcp-server',
  '/docs/publish/agent-preset',
  '/docs/publish/hook-bridge',
  '/docs/publish/profile',
  '/docs/publish/bundle',
  '/docs/submit',
  '/docs/scoring',
  '/docs/api',
  '/docs/developers',
] as const

describe('productDocsMarkdown', () => {
  it('bundles the index and nested publish pages', () => {
    expect(supportsProductDocsMarkdown('/docs')).toBe(true)
    expect(supportsProductDocsMarkdown('/docs/cli')).toBe(true)
    expect(supportsProductDocsMarkdown('/docs/publish/hook-bridge')).toBe(true)
    expect(productDocsMarkdown('/docs/cli')).toContain('npx @dsh-fish/cli')
    expect(productDocsMarkdown('/docs/publish/hook-bridge')).toContain('hook-bridge')
    expect(productDocsMarkdown('/docs/developers')).toContain('dsh.fish developer resources')
  })

  it('does not treat the search index as a document', () => {
    expect(supportsProductDocsMarkdown('/docs/search')).toBe(false)
    expect(productDocsMarkdown('/browse')).toBeUndefined()
  })

  it('returns localized Markdown and falls back to English', () => {
    expect(productDocsMarkdown('/docs', 'zh-CN')).toContain('dsh.fish')
    expect(productDocsMarkdown('/docs/cli', 'ja')).toContain('@dsh-fish/cli')
    expect(productDocsMarkdown('/docs/not-a-page', 'ru')).toBeUndefined()
  })

  it('has a physical translation of every guide in every public locale', () => {
    for (const path of DOC_PATHS) {
      expect(productDocsLocales(path), path).toEqual(LOCALE_CODES)
    }
  })

  it('enumerates every English guide from the bundled glob', () => {
    expect(productDocsPaths()).toEqual([...DOC_PATHS].sort((left, right) => left.localeCompare(right)))
  })
})
