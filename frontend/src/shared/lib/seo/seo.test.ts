import { describe, expect, it } from 'vitest'
import { LOCALE_CODES } from '@/shared/config/i18n'
import { pageMeta } from './meta'
import { organizationLd } from './structured-data'
import {
  alternates,
  clampDescription,
  coveringLlmsTxt,
  hasMarkdownAlternate,
  htmlPathFromMarkdownAlias,
  markdownPath,
} from './url'

const ORIGIN = 'https://dsh.fish'

type Descriptor = Record<string, unknown>

function find(list: Descriptor[], predicate: (entry: Descriptor) => boolean): Descriptor[] {
  return list.filter(predicate)
}

function content(list: Descriptor[], key: 'name' | 'property', value: string): string | undefined {
  return find(list, (entry) => entry[key] === value)[0]?.content as string | undefined
}

describe('alternates', () => {
  it('lists every language plus x-default', () => {
    const result = alternates(ORIGIN, '/browse')
    expect(result).toHaveLength(LOCALE_CODES.length + 1)
    expect(result.at(-1)).toEqual({
      hreflang: 'x-default',
      href: `${ORIGIN}/browse`,
    })
  })

  it('uses script subtags for Chinese, so a reader in Singapore is not excluded', () => {
    const tags = alternates(ORIGIN, '/').map((entry) => entry.hreflang)
    expect(tags).toContain('zh-Hans')
    expect(tags).toContain('zh-Hant')
    expect(tags).not.toContain('zh-CN')
  })

  it('is reciprocal: each language points at the same page in every other', () => {
    const fromJapanese = alternates(ORIGIN, '/a/dsh-hello').map((entry) => entry.href)
    const fromRussian = alternates(ORIGIN, '/a/dsh-hello').map((entry) => entry.href)
    expect(fromJapanese).toEqual(fromRussian)
    expect(fromJapanese).toContain(`${ORIGIN}/ja/a/dsh-hello`)
    expect(fromJapanese).toContain(`${ORIGIN}/ru/a/dsh-hello`)
  })
})

describe('clampDescription', () => {
  it('leaves a short description untouched', () => {
    expect(clampDescription('A short summary.')).toBe('A short summary.')
  })

  it('collapses whitespace, so a wrapped readme line does not leak into a snippet', () => {
    expect(clampDescription('one\n  two   three')).toBe('one two three')
  })

  it('cuts on a word boundary and marks the cut', () => {
    const result = clampDescription('alpha bravo charlie delta echo foxtrot', 20)
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result.endsWith('…')).toBe(true)
    expect(result).not.toContain('foxtrot')
  })
})

describe('pageMeta', () => {
  const indexed = pageMeta({
    origin: ORIGIN,
    locale: 'ja',
    path: '/a/dsh-hello',
    title: 'dsh-hello',
    description: 'A bundle.',
  }) as Descriptor[]

  it('canonicalises to the page in its own language', () => {
    const canonical = find(indexed, (entry) => entry.rel === 'canonical')
    expect(canonical).toHaveLength(1)
    expect(canonical[0]!.href).toBe(`${ORIGIN}/ja/a/dsh-hello`)
  })

  it('emits one hreflang alternate per language plus x-default', () => {
    const links = find(indexed, (entry) => entry.rel === 'alternate' && 'hrefLang' in entry)
    expect(links).toHaveLength(LOCALE_CODES.length + 1)
  })

  it('advertises the page language’s own Atom feed', () => {
    const feeds = find(
      indexed,
      (entry) => entry.rel === 'alternate' && entry.type === 'application/atom+xml',
    )
    expect(feeds).toHaveLength(1)
    expect(feeds[0]!.href).toBe(`${ORIGIN}/ja/feed.xml`)
  })

  it('points at the covering llms.txt and the markdown alias', () => {
    const describedby = find(
      indexed,
      (entry) => entry.rel === 'describedby' && entry.type === 'text/markdown',
    )
    expect(describedby).toHaveLength(1)
    expect(describedby[0]!.href).toBe(`${ORIGIN}/llms.txt`)

    const markdown = find(
      indexed,
      (entry) => entry.rel === 'alternate' && entry.type === 'text/markdown',
    )
    expect(markdown).toHaveLength(1)
    expect(markdown[0]!.href).toBe(`${ORIGIN}/ja/a/dsh-hello.md`)
  })

  it('names its own og:locale once and every other as an alternate', () => {
    expect(content(indexed, 'property', 'og:locale')).toBe('ja_JP')
    expect(find(indexed, (entry) => entry.property === 'og:locale:alternate')).toHaveLength(
      LOCALE_CODES.length - 1,
    )
  })

  it('asks for a large image preview so the social card can be used in a result', () => {
    expect(content(indexed, 'name', 'robots')).toContain('max-image-preview:large')
  })

  it('carries a Twitter card as well as Open Graph', () => {
    expect(content(indexed, 'name', 'twitter:card')).toBe('summary_large_image')
    expect(content(indexed, 'name', 'twitter:image')).toBe(`${ORIGIN}/og.png`)
    expect(content(indexed, 'name', 'twitter:image:alt')).toBe('DeepSeek Harness のプラグインハブ')
  })

  it('fully describes the preview image for Open Graph consumers', () => {
    expect(content(indexed, 'property', 'og:image:secure_url')).toBe(`${ORIGIN}/og.png`)
    expect(content(indexed, 'property', 'og:image:type')).toBe('image/png')
    expect(content(indexed, 'property', 'og:image:width')).toBe('1200')
    expect(content(indexed, 'property', 'og:image:height')).toBe('630')
    expect(content(indexed, 'property', 'og:image:alt')).toBe('DeepSeek Harness のプラグインハブ')
  })

  it('points og:image at a per-page renderer when one is given', () => {
    const own = pageMeta({
      origin: ORIGIN,
      locale: 'en',
      path: '/a/dsh-hello',
      title: 'dsh-hello',
      description: 'A bundle.',
      imagePath: '/a/dsh-hello/og.png',
    }) as Descriptor[]

    expect(content(own, 'property', 'og:image')).toBe(`${ORIGIN}/a/dsh-hello/og.png`)
    expect(content(own, 'name', 'twitter:image')).toBe(`${ORIGIN}/a/dsh-hello/og.png`)
  })

  describe('when the page is not for the index', () => {
    const excluded = pageMeta({
      origin: ORIGIN,
      locale: 'en',
      path: '/dashboard',
      title: 'Dashboard',
      description: 'Yours.',
      index: false,
    }) as Descriptor[]

    it('says noindex but stays followable', () => {
      expect(content(excluded, 'name', 'robots')).toBe('noindex, follow')
    })

    it('claims neither a canonical nor alternates, which would contradict it', () => {
      expect(find(excluded, (entry) => entry.rel === 'canonical')).toHaveLength(0)
      expect(find(excluded, (entry) => entry.rel === 'alternate')).toHaveLength(0)
      expect(find(excluded, (entry) => entry.rel === 'describedby')).toHaveLength(0)
    })
  })

  describe('when content exists in only one language', () => {
    const englishOnly = pageMeta({
      origin: ORIGIN,
      locale: 'en',
      path: '/docs',
      title: 'Documentation',
      description: 'Product documentation.',
      availableLocales: ['en'],
    }) as Descriptor[]

    it('keeps the real document canonical and indexable', () => {
      expect(find(englishOnly, (entry) => entry.rel === 'canonical')[0]?.href).toBe(
        `${ORIGIN}/docs`,
      )
      expect(content(englishOnly, 'name', 'robots')).toContain('index, follow')
    })

    it('does not advertise fallback copies as translated alternates', () => {
      expect(
        find(englishOnly, (entry) => entry.rel === 'alternate' && 'hrefLang' in entry),
      ).toHaveLength(0)
      expect(find(englishOnly, (entry) => entry.property === 'og:locale:alternate')).toHaveLength(0)
    })

    it('points docs pages at /docs/llms.txt and /docs/index.md', () => {
      expect(
        find(englishOnly, (entry) => entry.rel === 'describedby' && entry.type === 'text/markdown')[0]
          ?.href,
      ).toBe(`${ORIGIN}/docs/llms.txt`)
      expect(
        find(englishOnly, (entry) => entry.rel === 'alternate' && entry.type === 'text/markdown')[0]
          ?.href,
      ).toBe(`${ORIGIN}/docs/index.md`)
    })
  })

  it('attaches structured data blocks verbatim', () => {
    const withLd = pageMeta({
      origin: ORIGIN,
      locale: 'en',
      path: '/',
      title: 'dsh.fish',
      description: 'Hub.',
      jsonLd: [{ '@type': 'WebSite' }],
    }) as Descriptor[]
    const blocks = find(withLd, (entry) => 'script:ld+json' in entry)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!['script:ld+json']).toEqual({ '@type': 'WebSite' })
  })
})

describe('organizationLd', () => {
  it('uses the square brand mark as the organization logo, not the social card', () => {
    expect(organizationLd(ORIGIN, 'en').logo).toEqual({
      '@type': 'ImageObject',
      url: `${ORIGIN}/icons/whale-brand.png`,
      width: 256,
      height: 256,
    })
  })
})

describe('markdownPath', () => {
  it('appends .md, using index.md for directory URLs', () => {
    expect(markdownPath('/')).toBe('/index.md')
    expect(markdownPath('/docs')).toBe('/docs/index.md')
    expect(markdownPath('/docs/cli')).toBe('/docs/cli.md')
    expect(markdownPath('/a/dsh-hello')).toBe('/a/dsh-hello.md')
    expect(markdownPath('/browse')).toBe('/browse.md')
  })

  it('round-trips through the alias stripper', () => {
    for (const path of ['/', '/docs', '/docs/cli', '/a/dsh-hello', '/kind/skill']) {
      expect(htmlPathFromMarkdownAlias(markdownPath(path))).toBe(path)
    }
    expect(htmlPathFromMarkdownAlias('/browse')).toBeUndefined()
  })
})

describe('coveringLlmsTxt', () => {
  it('uses the docs file under /docs, otherwise the origin file', () => {
    expect(coveringLlmsTxt('/')).toBe('/llms.txt')
    expect(coveringLlmsTxt('/browse')).toBe('/llms.txt')
    expect(coveringLlmsTxt('/a/dsh-hello')).toBe('/llms.txt')
    expect(coveringLlmsTxt('/docs')).toBe('/docs/llms.txt')
    expect(coveringLlmsTxt('/docs/cli')).toBe('/docs/llms.txt')
  })
})

describe('hasMarkdownAlternate', () => {
  it('covers content pages and withholds UI-only paths', () => {
    expect(hasMarkdownAlternate('/')).toBe(true)
    expect(hasMarkdownAlternate('/browse')).toBe(true)
    expect(hasMarkdownAlternate('/docs/cli')).toBe(true)
    expect(hasMarkdownAlternate('/submit')).toBe(false)
    expect(hasMarkdownAlternate('/docs/search')).toBe(false)
    expect(hasMarkdownAlternate('/dashboard')).toBe(false)
  })
})
