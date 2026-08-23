import { htmlPathFromMarkdownAlias } from '@/shared/lib/seo'
import { localizedPath, splitLocalePath, translate, type Locale } from '@/shared/config/i18n'
import { prefersMarkdown, wantsMarkdownNotFound } from './negotiate'
import { markdownResponse } from './response'

/**
 * Whether a 404 should be rewritten as markdown.
 *
 * `.md` aliases always are — that URL exists only as markdown. HTML URLs
 * follow Accept: browsers that send `text/html` keep the HTML error page;
 * curl's default Accept wildcard (and an explicit `text/markdown`) get a short
 * recovery map instead of an app shell.
 */
export function shouldServeMarkdownNotFound(request: Request): boolean {
  const { path } = splitLocalePath(new URL(request.url).pathname)
  if (htmlPathFromMarkdownAlias(path) !== undefined) return true
  const accept = request.headers.get('accept')
  return prefersMarkdown(accept) || wantsMarkdownNotFound(accept)
}

/** Short recovery map for a missing page. Status is 404; cache is short. */
export function notFoundMarkdownResponse(origin: string, locale: Locale): Response {
  return markdownResponse(notFoundMarkdown(origin, locale), { status: 404 })
}

export function notFoundMarkdown(origin: string, locale: Locale): string {
  const base = origin.replace(/\/+$/, '')
  const home = `${base}${localizedPath(locale, '/')}`
  return [
    `# ${translate(locale, 'notFound.title')}`,
    '',
    translate(locale, 'notFound.body'),
    '',
    `## ${translate(locale, 'notFound.next')}`,
    '',
    `- [${translate(locale, 'notFound.home')}](${home})`,
    `- [${translate(locale, 'notFound.sitemap')}](${base}/sitemap.xml)`,
    `- [${translate(locale, 'notFound.llms')}](${base}/llms.txt)`,
    `- [${translate(locale, 'notFound.docs')}](${base}/docs)`,
    `- [${translate(locale, 'notFound.developers')}](${base}/docs/developers)`,
    `- [${translate(locale, 'notFound.openapi')}](${base}/openapi.json)`,
    `- [${translate(locale, 'notFound.api')}](${base}/api/v1/artifacts)`,
    '',
  ].join('\n')
}
