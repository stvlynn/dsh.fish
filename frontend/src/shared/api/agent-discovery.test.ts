import { describe, expect, it } from 'vitest'
import { withDiscoveryLinks } from './agent-discovery'

function htmlResponse(status = 200): Response {
  return new Response('<html></html>', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function markdownResponse(): Response {
  return new Response('# dsh.fish\n', {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  })
}

describe('withDiscoveryLinks', () => {
  it('adds the RFC 9727 discovery links and the covering llms.txt to an HTML page', () => {
    const response = withDiscoveryLinks(htmlResponse(), 'https://dsh.fish/browse?kind=skill', false)
    const links = response.headers.get('link')

    expect(links).toContain('</.well-known/api-catalog>; rel="api-catalog"')
    expect(links).toContain('</openapi.json>; rel="service-desc"')
    expect(links).toContain('</docs>; rel="service-doc"')
    expect(links).toContain('</api/v1/catalog/snapshot>; rel="describedby"')
    expect(links).toContain('</llms.txt>; rel="describedby"; type="text/markdown"')
  })

  it('points docs pages at /docs/llms.txt rather than the origin file', () => {
    const response = withDiscoveryLinks(htmlResponse(), 'https://dsh.fish/ja/docs/cli', true)
    const links = response.headers.get('link')

    expect(links).toContain('</docs/llms.txt>; rel="describedby"; type="text/markdown"')
    expect(links).not.toContain('</llms.txt>; rel="describedby"')
  })

  it('advertises the markdown alias, without the query', () => {
    const response = withDiscoveryLinks(
      htmlResponse(),
      'https://dsh.fish/ja/browse?kind=skill',
      true,
    )

    expect(response.headers.get('link')).toContain(
      '<https://dsh.fish/ja/browse.md>; rel="alternate"; type="text/markdown"',
    )
  })

  it('varies negotiated HTML by Accept without discarding existing fields', () => {
    const original = htmlResponse()
    original.headers.set('vary', 'Origin')
    const response = withDiscoveryLinks(original, 'https://dsh.fish/docs', true)

    expect(response.headers.get('vary')).toBe('Origin, Accept')
    expect(response.headers.get('link')).toContain(
      '<https://dsh.fish/docs/index.md>; rel="alternate"; type="text/markdown"',
    )
  })

  it('omits the alternate when the path has no markdown representation', () => {
    const response = withDiscoveryLinks(htmlResponse(), 'https://dsh.fish/submit', false)

    expect(response.headers.get('link')).not.toContain('rel="alternate"')
  })

  it('decorates markdown responses with describedby and skips the alternate', () => {
    const response = withDiscoveryLinks(
      markdownResponse(),
      'https://dsh.fish/docs/cli.md',
      false,
    )
    const links = response.headers.get('link')

    expect(links).toContain('</docs/llms.txt>; rel="describedby"; type="text/markdown"')
    expect(links).not.toContain('rel="alternate"')
  })

  it('leaves JSON and error responses untouched', () => {
    const json = withDiscoveryLinks(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
      'https://dsh.fish/api/v1/artifacts',
      true,
    )
    expect(json.headers.get('link')).toBeNull()

    const notFound = withDiscoveryLinks(htmlResponse(404), 'https://dsh.fish/nope', true)
    expect(notFound.headers.get('link')).toBeNull()
  })
})
