/**
 * Edge caching via the Cloudflare Cache API.
 *
 * The default CDN cache only considers responses whose URL ends in a cacheable
 * file extension, so `/sitemap.xml`-style resource routes, the catalog
 * snapshot, and every SSR page went to the origin on every request. This
 * wrapper matches against `caches.default` before the handler runs and stores
 * anonymous, explicitly cacheable responses afterwards.
 *
 * Only production builds participate: local dev and the Playwright e2e dev
 * server must always see fresh responses.
 */

const MARKDOWN_KEY_PARAM = '__dsh_accept'
const MARKDOWN_KEY_VALUE = 'markdown'

/** Browser lifetime for anonymous HTML, which the SSR pipeline sends without one. */
const ANONYMOUS_HTML_CACHE_CONTROL = 'public, max-age=300'

/**
 * True when the request may be served from, and stored in, the edge cache.
 *
 * A session cookie or credentials mean the response may be personalized, so
 * authenticated traffic bypasses the cache entirely.
 */
export function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false
  }
  return !request.headers.has('cookie') && !request.headers.has('authorization')
}

/**
 * The cache key for a request.
 *
 * The Cache API does not reliably vary on `Accept`, so markdown negotiation is
 * folded into the key's query string: HTML and markdown variants of the same
 * path never collide. The key is always a GET request — the Cache API rejects
 * `put` with any other method, and a HEAD lookup must find what a GET stored.
 */
export function buildCacheKey(request: Request): Request {
  const url = new URL(request.url)
  if (request.headers.get('accept')?.includes('text/markdown')) {
    url.searchParams.set(MARKDOWN_KEY_PARAM, MARKDOWN_KEY_VALUE)
  }
  return new Request(url.toString())
}

/**
 * Machine-readable routes, stored with the cache-control they already carry.
 * Everything here is a stable contract for crawlers and agents; none of it
 * has a cacheable file extension the CDN default would pick up.
 */
export function isMachineReadablePath(pathname: string): boolean {
  return (
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/sitemaps/') ||
    pathname === '/feed.xml' ||
    pathname === '/robots.txt' ||
    pathname === '/openapi.json' ||
    pathname === '/.well-known/api-catalog' ||
    pathname === '/llms.txt' ||
    pathname === '/docs/llms.txt' ||
    pathname === '/docs/llms-full.txt' ||
    pathname.startsWith('/indexnow-') ||
    pathname === '/api/v1/catalog/snapshot'
  )
}

/**
 * True when a response may be stored: a 200 without `Set-Cookie`, on either a
 * machine-readable route or an anonymous page (`text/html` / `text/markdown`
 * outside `/api/`). Redirects, errors, and the rest of the API are never stored.
 */
export function isStorableResponse(pathname: string, response: Response): boolean {
  if (response.status !== 200 || response.headers.has('set-cookie')) {
    return false
  }
  if (isMachineReadablePath(pathname)) {
    return true
  }
  if (pathname.startsWith('/api/')) {
    return false
  }
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('text/html') || contentType.includes('text/markdown')
}

/**
 * Serve `next()` through the edge cache. On a hit the handler never runs; on a
 * miss the response is stored in the background when it is storable.
 */
export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  next: () => Promise<Response>,
): Promise<Response> {
  if (!import.meta.env.PROD || !isCacheableRequest(request)) {
    return next()
  }

  // The DOM lib's `CacheStorage` shadows the Workers type on the global
  // `caches`; the Workers runtime adds `default`.
  const cache = (caches as unknown as { default: Cache }).default
  const key = buildCacheKey(request)
  const cached = await cache.match(key)
  if (cached !== undefined) {
    return cached
  }

  const pathname = new URL(request.url).pathname
  let response = await next()
  if (!isStorableResponse(pathname, response)) {
    return response
  }

  // Anonymous HTML carries no cache-control of its own; give the stored copy
  // (and the browser) a five-minute lifetime. Routes that already set one keep it.
  if (!response.headers.has('cache-control')) {
    response = new Response(response.body, response)
    response.headers.set('cache-control', ANONYMOUS_HTML_CACHE_CONTROL)
  }

  // A HEAD response has no body; storing it would poison the GET entry.
  if (request.method === 'GET') {
    ctx.waitUntil(cache.put(key, response.clone()))
  }
  return response
}
