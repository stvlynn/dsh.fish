import type { MetaDescriptor } from 'react-router'
import {
  DEFAULT_LOCALE,
  LOCALES,
  localeDefinition,
  matchLocale,
  translate,
  type Locale,
} from '@/shared/config/i18n'
import { OG_IMAGE } from '@/shared/config/site'
import {
  absoluteUrl,
  alternates,
  clampDescription,
  coveringLlmsTxt,
  hasMarkdownAlternate,
  markdownPath,
} from './url'

export interface PageMetaInput {
  readonly origin: string
  readonly locale: Locale
  /**
   * The page's path *without* a language prefix and without a query string —
   * `/browse`, `/a/dsh-hello`. The canonical URL and every alternate are built
   * from it, which is what keeps `?sort=recent` and `?offset=24` from minting
   * near-duplicate canonicals.
   */
  readonly path: string
  readonly title: string
  readonly description: string
  /**
   * Social image path, relative to the origin. Defaults to the site-wide card;
   * a page with its own renderer (an artifact's `/a/<id>/og.png`) passes its
   * own. Size and type stay those of OG_IMAGE: per-page renderers must match
   * them.
   */
  readonly imagePath?: string
  /** Default true. False emits `noindex, follow` and drops the alternates. */
  readonly index?: boolean
  readonly type?: 'website' | 'article'
  readonly jsonLd?: readonly Record<string, unknown>[]
  /** Locales with distinct, translated content. Defaults to every locale. */
  readonly availableLocales?: readonly Locale[]
}

/**
 * Every head tag a page needs to be found, in one call.
 *
 * React Router replaces the whole descriptor array per route rather than
 * merging it, so a page that writes its own `title` silently drops whatever the
 * root set. Building the full set here is what stops one page from shipping a
 * title and no canonical, or a canonical and no alternates — the failure mode
 * that quietly removes a page from nine of its ten language clusters.
 */
export function pageMeta(input: PageMetaInput): MetaDescriptor[] {
  const {
    origin,
    locale,
    path,
    title,
    description,
    imagePath = OG_IMAGE.path,
    index = true,
    type = 'website',
    jsonLd = [],
    availableLocales = LOCALES.map(({ code }) => code),
  } = input

  const url = absoluteUrl(origin, locale, path)
  const summary = clampDescription(description)
  const image = `${origin.replace(/\/+$/, '')}${imagePath}`
  const definition = localeDefinition(locale)

  const descriptors: MetaDescriptor[] = [
    { title },
    { name: 'description', content: summary },

    { property: 'og:site_name', content: translate(locale, 'app.name') },
    { property: 'og:title', content: title },
    { property: 'og:description', content: summary },
    { property: 'og:url', content: url },
    { property: 'og:type', content: type },
    { property: 'og:locale', content: definition.ogLocale },
    { property: 'og:image', content: image },
    ...(image.startsWith('https://') ? [{ property: 'og:image:secure_url', content: image }] : []),
    { property: 'og:image:type', content: OG_IMAGE.type },
    { property: 'og:image:width', content: String(OG_IMAGE.width) },
    { property: 'og:image:height', content: String(OG_IMAGE.height) },
    { property: 'og:image:alt', content: translate(locale, 'app.tagline') },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: summary },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: translate(locale, 'app.tagline') },
  ]

  // A link preview offers the reader other languages it could have rendered in.
  for (const other of LOCALES) {
    if (!availableLocales.includes(other.code)) continue
    if (other.code === locale) continue
    descriptors.push({
      property: 'og:locale:alternate',
      content: other.ogLocale,
    })
  }

  if (index) {
    // `max-image-preview:large` is what lets the social card show up as a real
    // image in a result rather than a thumbnail.
    descriptors.push({
      name: 'robots',
      content: 'index, follow, max-image-preview:large, max-snippet:-1',
    })
    // Canonical and alternates are emitted only on indexable pages. A `noindex`
    // page that also points a canonical at a different URL sends an engine two
    // contradictory instructions about the same document, and which one wins is
    // not defined — so a page that is not for the index claims no canonical.
    descriptors.push({ tagName: 'link', rel: 'canonical', href: url })
    for (const alternate of availableLocales.length > 1
      ? alternates(origin, path, availableLocales)
      : []) {
      descriptors.push({
        tagName: 'link',
        rel: 'alternate',
        // React's spelling, not the spec's. `Meta` spreads a link descriptor
        // straight onto the element without React DOM's attribute mapping, so
        // this renders literally as `hrefLang="ja"` — which HTML parses as
        // `hreflang`, attribute names being case-insensitive. The lower-cased
        // key produces the spec spelling but makes React log an invalid-property
        // warning on every page, and a permanent console error is the kind of
        // thing someone later "fixes" without knowing why it was there.
        hrefLang: alternate.hreflang,
        href: alternate.href,
      })
    }
    // Feed autodiscovery. Each page advertises its own language's feed: the
    // feed exists in every language the page does, and a feed-aware client
    // offers the reader the channel in the language they are already reading.
    descriptors.push({
      tagName: 'link',
      rel: 'alternate',
      type: 'application/atom+xml',
      title: translate(locale, 'feed.title'),
      href: absoluteUrl(origin, locale, '/feed.xml'),
    })
    // llms.txt v2: the covering overview, and the markdown alias when this
    // path has one. Headers on the response repeat the same relations so an
    // agent that never parses `<head>` still finds them.
    descriptors.push({
      tagName: 'link',
      rel: 'describedby',
      type: 'text/markdown',
      href: `${origin.replace(/\/+$/, '')}${coveringLlmsTxt(path)}`,
    })
    if (hasMarkdownAlternate(path)) {
      descriptors.push({
        tagName: 'link',
        rel: 'alternate',
        type: 'text/markdown',
        href: absoluteUrl(origin, locale, markdownPath(path)),
      })
    }
  } else {
    // `follow` still: a signed-in-only page is not worth indexing, but the links
    // out of it lead to pages that are.
    descriptors.push({ name: 'robots', content: 'noindex, follow' })
  }

  for (const block of jsonLd) {
    descriptors.push({ 'script:ld+json': block as Record<string, never> })
  }

  return descriptors
}

/**
 * Head tags for a route whose loader threw.
 *
 * Every localized loader can throw — `requireLocale` rejects a first segment
 * that is not a language, and a detail loader rejects an id that is not in the
 * catalog. React Router still calls `meta` in that case, with no loader data,
 * so a `meta` that reads `loaderData` unguarded turns a clean 404 into a render
 * crash. Each one starts by handing an absent `loaderData` to this.
 *
 * The locale comes from the raw route parameter rather than from loader data
 * there is none of; anything unrecognised falls back to the default language,
 * which is the right guess for a URL that was already wrong.
 */
export function errorMeta(rawLocale?: string): MetaDescriptor[] {
  const locale = matchLocale(rawLocale) ?? DEFAULT_LOCALE
  return [
    {
      title: `${translate(locale, 'notFound.title')} — ${translate(locale, 'app.name')}`,
    },
    { name: 'robots', content: 'noindex, follow' },
  ]
}

/** `<html lang>` and `dir`, from the same registry the URLs come from. */
export function documentLanguage(locale: Locale): {
  lang: string
  dir: 'ltr' | 'rtl'
} {
  const definition = localeDefinition(locale)
  return { lang: definition.tag, dir: definition.dir }
}
