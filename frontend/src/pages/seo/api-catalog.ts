import type { Route } from './+types/api-catalog'
import { hubContext } from '@/shared/api/hub-context'

/**
 * `/.well-known/api-catalog` — the RFC 9727 api-catalog document.
 *
 * One linkset that tells a machine where every machine-readable door into the
 * catalog is: the OpenAPI description of the JSON API, the human documentation,
 * the health check, the whole-catalog snapshot, and `/llms.txt`. HTML pages advertise this
 * URL in a `Link: …; rel="api-catalog"` header (RFC 8288), so an agent learns
 * it without parsing any markup.
 */
export function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(hubContext).container.config

  return new Response(apiCatalogDocument(baseUrl), {
    headers: {
      'content-type': 'application/linkset+json; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  })
}

export function apiCatalogDocument(baseUrl: string): string {
  return JSON.stringify(
    {
      linkset: [
        {
          anchor: `${baseUrl}/api/v1`,
          'service-desc': [
            {
              href: `${baseUrl}/openapi.json`,
              type: 'application/vnd.oai.openapi+json',
            },
          ],
          'service-doc': [{ href: `${baseUrl}/docs`, type: 'text/html' }],
          status: [{ href: `${baseUrl}/api/health`, type: 'application/json' }],
        },
        {
          anchor: baseUrl,
          describedby: [
            {
              href: `${baseUrl}/api/v1/catalog/snapshot`,
              type: 'application/json',
            },
            {
              href: `${baseUrl}/llms.txt`,
              type: 'text/markdown',
            },
          ],
        },
      ],
    },
    null,
    2,
  )
}
