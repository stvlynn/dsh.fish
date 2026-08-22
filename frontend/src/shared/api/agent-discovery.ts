import { localizedPath, splitLocalePath } from '@/shared/config/i18n'
import {
  coveringLlmsTxt,
  htmlPathFromMarkdownAlias,
  markdownPath,
} from '@/shared/lib/seo'

/**
 * Agent-discovery `Link` headers (RFC 8288).
 *
 * Every HTML or markdown document carries pointers to the machine-readable
 * doors into the catalog, so an agent that lands on any page learns — without
 * parsing the markup — where the api-catalog, the OpenAPI description, the
 * human docs, the bulk snapshot and the covering llms.txt are. RFC 9727 only
 * asks for the api-catalog link on the origin root; repeating the set on every
 * page costs a handful of headers and removes the homepage as a single point
 * of discovery.
 *
 * When the page has a markdown representation, an `alternate` link points at
 * the `.md` alias (llms.txt v2). `Accept: text/markdown` still works on the
 * HTML URL; the alias is what agents following llms.txt actually GET.
 */
const DISCOVERY_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</docs>; rel="service-doc"; type="text/html"',
  '</api/v1/catalog/snapshot>; rel="describedby"; type="application/json"',
] as const

function unlocalizedHtmlPath(pathname: string): string {
  const { path } = splitLocalePath(pathname)
  return htmlPathFromMarkdownAlias(path) ?? path
}

export function withDiscoveryLinks(
  response: Response,
  requestUrl: string,
  hasMarkdownAlternate: boolean,
): Response {
  const contentType = response.headers.get('content-type') ?? ''
  const isHtml = contentType.startsWith('text/html')
  const isMarkdown = contentType.startsWith('text/markdown')
  if (response.status !== 200 || (!isHtml && !isMarkdown)) return response

  const url = new URL(requestUrl)
  const htmlPath = unlocalizedHtmlPath(url.pathname)
  const { locale } = splitLocalePath(url.pathname)
  const decorated = new Response(response.body, response)
  for (const link of DISCOVERY_LINKS) decorated.headers.append('Link', link)
  decorated.headers.append(
    'Link',
    `<${coveringLlmsTxt(htmlPath)}>; rel="describedby"; type="text/markdown"`,
  )
  if (isHtml && hasMarkdownAlternate) {
    const markdownHref = `${url.origin}${localizedPath(locale, markdownPath(htmlPath))}`
    decorated.headers.append('Link', `<${markdownHref}>; rel="alternate"; type="text/markdown"`)
    decorated.headers.append('Vary', 'Accept')
  }
  return decorated
}
