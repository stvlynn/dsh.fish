import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequestHandler } from 'react-router'
import type { ServerBuild } from 'react-router'
import { createNodeRuntime } from '@dsh-fish/backend/infrastructure/node/runtime.js'
import { AdaClient } from '@dsh-fish/backend/infrastructure/ada/ada-client.js'
import { openNodeAdaSocket } from '@dsh-fish/backend/infrastructure/node/ada-socket.js'
import { LOCALE_CODES } from '@/shared/config/i18n'
import { createSiteHandler } from './handle-request'
import { withPublicCacheHeaders } from './cache-headers'
import { withNodeAdmission } from './admission'
import { catalogRequestPaused, pausedResponse } from '@dsh-fish/backend'

const runtime = await createNodeRuntime(process.env, LOCALE_CODES)
const buildUrl = new URL('../server/index.js', import.meta.url)
const build = (await import(buildUrl.href)) as ServerBuild
const site = createSiteHandler({
  context: (
    build.entry.module as typeof build.entry.module & {
      hubContext: typeof import('@/shared/api/hub-context').hubContext
    }
  ).hubContext,
  requestHandler: createRequestHandler(build, 'production'),
  readmeLocalization: () => runtime.jobs,
  containerOptions: {
    persistence: runtime.persistence,
    ada: new AdaClient({ openSocket: openNodeAdaSocket }),
  },
})
const tasks = new Set<Promise<unknown>>()
const context = {
  waitUntil(task: Promise<unknown>) {
    const tracked = task.catch(() =>
      console.error(JSON.stringify({ event: 'background_task_failed' })),
    )
    tasks.add(tracked)
    void tracked.then(() => tasks.delete(tracked))
  },
  passThroughOnException() {},
} as ExecutionContext
let draining = false
const app = new Hono()

app.use('*', async (c, next) => {
  const started = performance.now()
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID()
  try {
    await next()
  } finally {
    c.header('x-request-id', requestId)
    c.header('x-content-type-options', 'nosniff')
    c.header('referrer-policy', 'strict-origin-when-cross-origin')
    console.info(
      JSON.stringify({
        event: 'http_request',
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      }),
    )
  }
})
app.get('/api/ready', async (c) => {
  if (draining) return c.json({ status: 'draining' }, 503)
  await runtime.ready()
  c.header('cache-control', 'no-store')
  return c.json({ status: 'ready' })
})
app.use('/assets/*', async (c, next) => {
  c.header('cache-control', 'public, max-age=31536000, immutable')
  await next()
})
app.use('*', serveStatic({ root: './build/client' }))
app.all('*', async (c) => {
  if (draining) return new Response(null, { status: 503, headers: { 'retry-after': '5' } })
  const url = new URL(c.req.url)
  const canonical = new URL(url.pathname + url.search, runtime.env.PUBLIC_BASE_URL)
  const request = new Request(canonical, c.req.raw)
  if (catalogRequestPaused(request, runtime.env)) return pausedResponse()
  return withNodeAdmission(request, runtime.redis, () =>
    withPublicCacheHeaders(request, () => site(request, runtime.env, context)),
  )
})
app.onError((_error, c) => {
  console.error(
    JSON.stringify({
      event: 'unhandled_request_error',
      requestId: c.res.headers.get('x-request-id'),
      path: c.req.path,
    }),
  )
  return new Response(null, {
    status: 503,
    headers: { 'cache-control': 'no-store', 'retry-after': '5' },
  })
})

await runtime.start()
const port = Number(process.env.PORT ?? '3000')
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid PORT.')
const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port }, () => {
  console.info(JSON.stringify({ event: 'server_started', port, runtime: 'node' }))
})

async function shutdown() {
  if (draining) return
  draining = true
  const deadline = setTimeout(() => process.exit(1), 90_000)
  deadline.unref()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await Promise.all([...tasks])
  await runtime.close()
  clearTimeout(deadline)
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    void shutdown().catch(() => process.exit(1))
  })
}
