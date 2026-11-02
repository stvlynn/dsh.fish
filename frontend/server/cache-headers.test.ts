import { describe, expect, it } from 'vitest'
import { withPublicCacheHeaders } from './cache-headers'

describe('anonymous document cache policy', () => {
  it('varies public documents by representation', async () => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/'),
      async () => new Response('home', { headers: { 'content-type': 'text/html' } }),
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=30, stale-if-error=300')
    expect(response.headers.get('vary')).toContain('Accept')
  })
  it.each(['no-store', 'private, max-age=0', 'public, no-cache', 'public, must-revalidate', 'public, max-age=0, stale-if-error=0, stale-while-revalidate=0'])('respects explicit %s', async (policy) => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/'),
      async () =>
        new Response('home', {
          headers: { 'content-type': 'text/html', 'cache-control': policy },
        }),
    )
    expect(response.headers.get('cache-control')).toBe(policy)
  })
  it('gives anonymous catalog JSON a short lifetime and bounded stale windows', async () => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/api/v1/artifacts?q=git'),
      async () => Response.json({ items: [] }),
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=15, stale-while-revalidate=30, stale-if-error=300')
  })
  it('adds bounded stale windows to existing public Markdown without duplicating Vary', async () => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/browse.md'),
      async () => new Response('listing', { headers: {
        'content-type': 'text/markdown', 'cache-control': 'public, max-age=60', vary: 'Accept',
      } }),
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=30, stale-if-error=300')
    expect(response.headers.get('vary')).toBe('Accept')
  })
  it.each([
    ['cookie', 'session=private'],
    ['authorization', 'Bearer private'],
  ])('does not make credentialed responses public', async (name, value) => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/', { headers: { [name]: value } }),
      async () => new Response('private', { headers: { 'content-type': 'text/html' } }),
    )
    expect(response.headers.has('cache-control')).toBe(false)
  })
})
