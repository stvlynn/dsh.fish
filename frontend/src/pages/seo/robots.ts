import type { Route } from './+types/robots'
import { hubContext } from '@/shared/api/hub-context'
import { localizedPath, LOCALE_CODES } from '@/shared/config/i18n'

/**
 * `/robots.txt`.
 *
 * Account pages are deliberately crawlable even though their own head tags say
 * `noindex`. A crawler has to fetch a page before it can see that directive;
 * blocking the same URL here can leave the URL indexed without a snippet.
 *
 * `/api/` is disallowed for the same reason: it answers JSON, and a crawler
 * enumerating it learns nothing the HTML pages do not already say.
 *
 * Filtered `/browse` views are disallowed, in every locale. They were
 * `noindex, follow`, which keeps them out of results but invites every crawler
 * to fetch them — and a catalog with repeatable facets mints millions of them,
 * each a fresh database query. Google's faceted-navigation guidance is to
 * prevent crawling such URLs in robots.txt when they need not be indexed. The
 * pages worth ranking keep their own paths (`/browse`, `/kind/…`,
 * `/category/…`, `/for/…`, `/a/…`) and the sitemap still lists every one. The
 * bare `/browse` stays crawlable: the pattern requires a `?`.
 *
 * Each group repeats the rules it needs. A crawler obeys only the most specific
 * group naming it, so a rule written once under `*` would not apply to the
 * named search agents above it.
 *
 * Nothing here is a security boundary. robots.txt is a request, and the paths
 * it names are exactly the paths anyone can read in it.
 */
export function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(hubContext).container.config

  return new Response(robotsText(baseUrl), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  })
}

/** `Disallow` lines for filtered browse views in every locale. */
function filteredBrowseRules(): string[] {
  return LOCALE_CODES.map((locale) => `Disallow: ${localizedPath(locale, '/browse')}?`)
}

export function robotsText(baseUrl: string): string {
  return [
    ...['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User'].flatMap(
      (agent) => [
        `User-agent: ${agent}`,
        'Allow: /',
        'Allow: /api/v1/catalog/snapshot',
        'Disallow: /api/',
        ...filteredBrowseRules(),
        '',
      ],
    ),
    'User-agent: GPTBot',
    'Disallow: /',
    '',
    'User-agent: ClaudeBot',
    'Disallow: /',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    ...filteredBrowseRules(),
    '',
    '# Atom feeds live at /feed.xml and /<locale>/feed.xml; the IndexNow key',
    '# file at /indexnow-<key>.txt. Both are crawlable by design.',
    '# Authorized digital sellers: /ads.txt.',
    '# Agents: /llms.txt (site), /docs/llms.txt (guides), /blog/llms.txt (posts). Markdown mirrors append .md.',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n')
}
