import { isCacheableRequest, isStorableResponse } from '../workers/edge-cache'

/** Only anonymous successful documents receive a public origin-cache lifetime. */
export async function withPublicCacheHeaders(
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  const response = await handle()
  if (!isCacheableRequest(request) || !isStorableResponse(new URL(request.url).pathname, response))
    return response
  if (response.headers.has('cache-control')) return response
  const cached = new Response(response.body, response)
  cached.headers.set('cache-control', 'public, max-age=300')
  cached.headers.append('vary', 'Accept')
  return cached
}
