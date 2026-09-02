import type { Route } from './+types/robots'
import { hubContext } from '@/shared/api/hub-context'

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
 * Query strings and `.md` aliases are disallowed for the generic crawler
 * (`User-agent: *`, which is Googlebot). Every `?` URL is a view of a path
 * that already has a canonical home — `/browse?q=`, `?offset=`, `?profile=` —
 * and the Pages coverage export showed Google spending the
 * crawl budget fetching ~100k of those `noindex` views instead of the ~36k
 * sitemap URLs. `.md` aliases are the agent mirror of those same pages;
 * retrieval bots keep `Allow: /` in their own group so they still reach them.
 * Plugin pages on listing page two onwards stay discoverable through the
 * artifact sitemap, so blocking `?offset=` does not hide the catalog.
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

export function robotsText(baseUrl: string): string {
  return [
    ...['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User'].flatMap(
      (agent) => [
        `User-agent: ${agent}`,
        'Allow: /',
        'Allow: /api/v1/catalog/snapshot',
        'Disallow: /api/',
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
    // Faceted views and pagination. The sitemap already lists every artifact;
    // these URLs are `noindex, follow` in HTML and must not spend crawl budget.
    'Disallow: /*?',
    // Agent markdown aliases. Retrieval user-agents above keep Allow: /.
    'Disallow: /*.md$',
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
