import { LOCALE_CODES, localizedPath, type Locale } from '@/shared/config/i18n'
import { DESCRIPTION_MAX } from '@/shared/config/site'

/**
 * Absolute URL for one unlocalized path in one language.
 *
 * Canonical and `hreflang` values must be absolute — a relative `href` in either
 * is either ignored or resolved against the wrong base — so every SEO tag goes
 * through here rather than interpolating a path into a template.
 */
export function absoluteUrl(origin: string, locale: Locale, path: string): string {
  return `${origin.replace(/\/+$/, '')}${localizedPath(locale, path)}`
}

export interface Alternate {
  readonly hreflang: string
  readonly href: string
}

/**
 * The full `hreflang` set for one page.
 *
 * Reciprocity is what makes the cluster work: every language's URL lists every
 * other language's URL, including its own, so a crawler that lands on any one
 * of them discovers the rest. `x-default` points at the unprefixed default
 * language, which is what an engine serves when it cannot match the reader's
 * own language to one we publish.
 */
export function alternates(
  origin: string,
  path: string,
  locales: readonly Locale[] = LOCALE_CODES,
): readonly Alternate[] {
  return [
    ...locales.map((code) => ({
      hreflang: hreflangFor(code),
      href: absoluteUrl(origin, code, path),
    })),
    ...(locales.includes('en')
      ? [{ hreflang: 'x-default', href: absoluteUrl(origin, 'en', path) }]
      : []),
  ]
}

/**
 * The `hreflang` value for a locale.
 *
 * Script subtags (`zh-Hans`) rather than region ones (`zh-CN`) for Chinese: a
 * reader in Singapore reads simplified Chinese and would be excluded by a
 * region match, while the script is exactly what distinguishes the two catalogs
 * we actually maintain. Everything else has no such split and uses its own code.
 */
export function hreflangFor(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh-Hans' : locale === 'zh-TW' ? 'zh-Hant' : locale
}

/**
 * The conventional markdown alias for an HTML path (llms.txt v2).
 *
 * Paths here have no filename extension, so the alias appends `.md`. Directory
 * URLs (`/` and `/docs`) use `index.md` so the docs tree stays under `/docs/`
 * and `/docs/llms.txt` covers it.
 */
export function markdownPath(unlocalizedPath: string): string {
  if (unlocalizedPath === '/') return '/index.md'
  if (unlocalizedPath === '/docs') return '/docs/index.md'
  return `${unlocalizedPath}.md`
}

/**
 * The HTML path a `.md` alias maps back to, or `undefined` when the path is
 * not an alias. `/index.md` is the home page; any other `…/index.md` drops
 * that last segment.
 */
export function htmlPathFromMarkdownAlias(unlocalizedPath: string): string | undefined {
  if (unlocalizedPath === '/index.md') return '/'
  if (unlocalizedPath.endsWith('/index.md')) {
    const parent = unlocalizedPath.slice(0, -'/index.md'.length)
    return parent === '' ? '/' : parent
  }
  if (unlocalizedPath.endsWith('.md')) return unlocalizedPath.slice(0, -'.md'.length)
  return undefined
}

/**
 * The llms.txt file that covers this HTML path (v2: most specific wins).
 * `/docs/llms.txt` covers the product-docs tree; `/llms.txt` covers the rest.
 */
export function coveringLlmsTxt(unlocalizedPath: string): string {
  return unlocalizedPath === '/docs' || unlocalizedPath.startsWith('/docs/')
    ? '/docs/llms.txt'
    : '/llms.txt'
}

/**
 * Whether this HTML path has a markdown representation — either via
 * `Accept: text/markdown` or the `.md` alias. Taxonomy membership is not
 * checked: an unknown kind 404s before `pageMeta` runs.
 */
export function hasMarkdownAlternate(unlocalizedPath: string): boolean {
  if (unlocalizedPath === '/' || unlocalizedPath === '/browse') return true
  if (/^\/a\/[^/]+$/.test(unlocalizedPath)) return true
  if (/^\/kind\/[^/]+$/.test(unlocalizedPath)) return true
  if (/^\/category\/[^/]+$/.test(unlocalizedPath)) return true
  if (unlocalizedPath === '/docs') return true
  return unlocalizedPath.startsWith('/docs/') && unlocalizedPath !== '/docs/search'
}

/**
 * Trim a description to something an engine will show whole.
 *
 * Cuts on a word boundary and adds an ellipsis, so a clamped summary reads as
 * deliberately shortened rather than as a truncation bug.
 */
export function clampDescription(value: string, max = DESCRIPTION_MAX): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:—-]+$/, '')}…`
}
