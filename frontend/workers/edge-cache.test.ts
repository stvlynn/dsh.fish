import { describe, expect, it } from 'vitest'

import {
  buildCacheKey,
  isCacheableRequest,
  isMachineReadablePath,
  isStorableResponse,
} from './edge-cache'

describe('isCacheableRequest', () => {
  it('allows anonymous GET and HEAD requests', () => {
    expect(isCacheableRequest(new Request('https://dsh.fish/browse'))).toBe(true)
    expect(isCacheableRequest(new Request('https://dsh.fish/browse', { method: 'HEAD' }))).toBe(true)
  })

  it('rejects other methods', () => {
    expect(isCacheableRequest(new Request('https://dsh.fish/browse', { method: 'POST' }))).toBe(
      false,
    )
  })

  it('rejects requests with credentials', () => {
    expect(
      isCacheableRequest(
        new Request('https://dsh.fish/browse', { headers: { cookie: 'session=abc' } }),
      ),
    ).toBe(false)
    expect(
      isCacheableRequest(
        new Request('https://dsh.fish/browse', { headers: { authorization: 'Bearer t' } }),
      ),
    ).toBe(false)
  })
})

describe('buildCacheKey', () => {
  it('keeps the URL as-is for HTML requests', () => {
    const key = buildCacheKey(
      new Request('https://dsh.fish/browse?q=git', { headers: { accept: 'text/html' } }),
    )
    expect(key.url).toBe('https://dsh.fish/browse?q=git')
  })

  it('marks markdown negotiation in the query string', () => {
    const key = buildCacheKey(
      new Request('https://dsh.fish/browse', {
        headers: { accept: 'text/markdown, text/html;q=0.9' },
      }),
    )
    expect(new URL(key.url).searchParams.get('__dsh_accept')).toBe('markdown')
  })

  it('always builds a GET key so HEAD lookups hit what a GET stored', () => {
    const key = buildCacheKey(new Request('https://dsh.fish/browse', { method: 'HEAD' }))
    expect(key.method).toBe('GET')
  })
})

describe('isMachineReadablePath', () => {
  it.each([
    '/sitemap.xml',
    '/sitemaps/plugins-1.xml',
    '/feed.xml',
    '/robots.txt',
    '/openapi.json',
    '/.well-known/api-catalog',
    '/llms.txt',
    '/docs/llms.txt',
    '/docs/llms-full.txt',
    '/indexnow-abc123.txt',
    '/api/v1/catalog/snapshot',
  ])('matches %s', (pathname) => {
    expect(isMachineReadablePath(pathname)).toBe(true)
  })

  it.each(['/browse', '/api/v1/plugins', '/sitemaps', '/feed.xml/extra'])(
    'does not match %s',
    (pathname) => {
      expect(isMachineReadablePath(pathname)).toBe(false)
    },
  )
})

describe('isStorableResponse', () => {
  const response = (init: {
    status?: number
    contentType?: string
    setCookie?: boolean
  }): Response => {
    const headers = new Headers()
    if (init.contentType !== undefined) {
      headers.set('content-type', init.contentType)
    }
    if (init.setCookie === true) {
      headers.set('set-cookie', 'session=abc; HttpOnly')
    }
    return new Response('body', { status: init.status ?? 200, headers })
  }

  it('stores machine-readable routes with their own cache-control', () => {
    expect(isStorableResponse('/sitemap.xml', response({ contentType: 'application/xml' }))).toBe(
      true,
    )
    expect(
      isStorableResponse('/api/v1/catalog/snapshot', response({ contentType: 'application/json' })),
    ).toBe(true)
  })

  it('stores anonymous HTML and markdown outside the API', () => {
    expect(
      isStorableResponse('/browse', response({ contentType: 'text/html; charset=utf-8' })),
    ).toBe(true)
    expect(
      isStorableResponse('/browse', response({ contentType: 'text/markdown; charset=utf-8' })),
    ).toBe(true)
  })

  it('never stores redirects, errors, or Set-Cookie responses', () => {
    expect(isStorableResponse('/browse', response({ status: 301 }))).toBe(false)
    expect(isStorableResponse('/sitemap.xml', response({ status: 500 }))).toBe(false)
    expect(
      isStorableResponse('/browse', response({ contentType: 'text/html', setCookie: true })),
    ).toBe(false)
  })

  it('never stores the rest of the API', () => {
    expect(
      isStorableResponse('/api/v1/plugins', response({ contentType: 'application/json' })),
    ).toBe(false)
  })

  it('does not store non-document content outside the whitelist', () => {
    expect(isStorableResponse('/browse', response({ contentType: 'application/json' }))).toBe(
      false,
    )
  })
})
