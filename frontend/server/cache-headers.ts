import { isCacheableRequest, isStorableResponse } from '../workers/edge-cache'

/** Bounded freshness and stale windows for anonymous origin responses. */
export const ORIGIN_CACHE_POLICY = Object.freeze({
  documentSeconds: 300,
  catalogSeconds: 15,
  revalidateSeconds: 30,
  errorSeconds: 300,
})

/** Add a bounded stale policy without relaxing explicit privacy/revalidation rules. */
export async function withPublicCacheHeaders(
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  const response = await handle()
  const pathname = new URL(request.url).pathname
  const catalog = pathname === '/api/v1/artifacts'
  if (!isCacheableRequest(request) || response.status !== 200 || response.headers.has('set-cookie')) {
    return response
  }
  if (!catalog && !isStorableResponse(pathname, response)) return response

  const existing = response.headers.get('cache-control')
  const directives = new Set((existing ?? '').split(',').map((part) => part.trim().split('=')[0]?.toLowerCase()))
  if (existing !== null && (
    !directives.has('public') ||
    ['private', 'no-store', 'no-cache', 'must-revalidate', 'proxy-revalidate', 's-maxage'].some((key) => directives.has(key))
  )) return response

  const policy = [existing ?? `public, max-age=${catalog ? ORIGIN_CACHE_POLICY.catalogSeconds : ORIGIN_CACHE_POLICY.documentSeconds}`]
  if (!directives.has('stale-while-revalidate')) {
    policy.push(`stale-while-revalidate=${ORIGIN_CACHE_POLICY.revalidateSeconds}`)
  }
  if (!directives.has('stale-if-error')) {
    policy.push(`stale-if-error=${ORIGIN_CACHE_POLICY.errorSeconds}`)
  }
  const cached = new Response(response.body, response)
  cached.headers.set('cache-control', policy.join(', '))
  // Preserve existing representation variation without duplicating its field.
  if (!catalog && !cached.headers.get('vary')?.split(',').some((value) => value.trim().toLowerCase() === 'accept')) {
    cached.headers.append('vary', 'Accept')
  }
  return cached
}
