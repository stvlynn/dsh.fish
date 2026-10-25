import { describe, expect, it } from 'vitest'
import { withPublicCacheHeaders } from './cache-headers'

describe('anonymous document cache policy', () => {
  it('varies public documents by representation', async () => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/'),
      async () => new Response('home', { headers: { 'content-type': 'text/html' } }),
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(response.headers.get('vary')).toContain('Accept')
  })
  it.each(['no-store', 'private, max-age=0'])('respects explicit %s', async (policy) => {
    const response = await withPublicCacheHeaders(
      new Request('https://dsh.fish/'),
      async () =>
        new Response('home', {
          headers: { 'content-type': 'text/html', 'cache-control': policy },
        }),
    )
    expect(response.headers.get('cache-control')).toBe(policy)
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
