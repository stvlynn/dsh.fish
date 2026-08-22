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
    '',
    '# Atom feeds live at /feed.xml and /<locale>/feed.xml; the IndexNow key',
    '# file at /indexnow-<key>.txt. Both are crawlable by design.',
    '# Agents: /llms.txt (site), /docs/llms.txt (guides). Markdown mirrors append .md.',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n')
}
