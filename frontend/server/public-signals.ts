export function withPublicSignals(response: Response, request: Request): Response {
  const headers = new Headers(response.headers)
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  const pathname = new URL(request.url).pathname
  const publicRead =
    (request.method === 'GET' || request.method === 'HEAD') &&
    !pathname.startsWith('/api/auth/') &&
    !/^\/(?:[^/]+\/)?(?:dashboard|device|sign-in)(?:\/|$)/.test(pathname)
  if (publicRead && !headers.has('content-signal')) {
    headers.set('content-signal', 'ai-train=no, search=yes, ai-input=yes, use=reference')
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
