import { Hono } from 'hono'
import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'
import type { Actor } from '../../domain/account/account.js'
import { createContainer } from '../../infrastructure/container.js'
import type { Container } from '../../infrastructure/container.js'
import type { HubEnv } from '../../infrastructure/config/env.js'
import type { ReadmeLocalizationScheduler } from '../../application/port/readme-localization.js'
import { hintFor, toApiError, type ApiErrorBody } from './error-mapper.js'
import { isDomainError } from '../../domain/shared/error.js'
import { readRequestSession } from '../../infrastructure/auth/request-session.js'
import { catalogRoutes } from './route/catalog-routes.js'
import { askRoutes } from './route/ask-routes.js'
import { reviewRoutes } from './route/review-routes.js'
import { submissionRoutes } from './route/submission-routes.js'
import { adminRoutes } from './route/admin-routes.js'

export interface HubBindings {
  Bindings: HubEnv
  Variables: {
    container: Container
    actor: Actor | undefined
  }
}

/**
 * The API surface, mounted at `/api` by the Worker entry.
 *
 * Controllers stay thin on purpose: parse input, call one use case, format the
 * result. Every branch that decides anything lives in `application` or
 * `domain`, which is what lets the `@dsh-fish/hub` plugin and the website share
 * behavior rather than each re-implementing it against raw rows.
 */
export function createApiApp(options: {
  readonly readmeLocalization: (env: HubEnv) => ReadmeLocalizationScheduler
}) {
  // The Worker forwards the request with its original path, so the router is
  // mounted at the same prefix the client calls. Better Auth also defaults to
  // `/api/auth`, so its routes line up without extra rewriting.
  const app = new Hono<HubBindings>().basePath('/api')

  // Liveness, registered before any middleware: a health probe that needs the
  // container, D1 and a session lookup reports the health of those things, not
  // of the Worker, and goes red for reasons a restart cannot fix.
  app.get('/health', (context) => context.json({ status: 'ok' }))

  app.use('*', async (context, next) => {
    if (catalogRequestPaused(context.req.raw, context.env)) return pausedResponse()
    const container = await createContainer(context.env, {
      cf: context.req.raw.cf as IncomingRequestCfProperties,
      readmeLocalization: options.readmeLocalization(context.env),
    })
    context.res = await withContainerLifecycle(
      container,
      async () => {
        context.set('container', container)
        context.set('actor', await resolveActor(container, context.req.raw))
        await next()
        return context.res
      },
      context.executionCtx,
      context.req.method === 'HEAD',
    )
  })

  app.onError((error, context) => {
    const { status, body } = toApiError(error)
    if (status === 500) {
      console.error('unhandled_api_error', {
        path: context.req.path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    if (isDomainError(error) && typeof error.details.retryAfter === 'number') {
      context.header('Retry-After', String(Math.max(0, Math.floor(error.details.retryAfter))))
    }
    return context.json(body, status)
  })

  // Better Auth owns every `/api/auth/*` route: sign-in, OAuth callbacks,
  // session reads, and the device grant the `@dsh-fish/hub` plugin polls.
  app.all('/auth/*', (context) => context.get('container').auth.handler(context.req.raw))

  app.route('/v1', catalogRoutes())
  app.route('/v1', askRoutes())
  app.route('/v1', reviewRoutes())
  app.route('/v1', submissionRoutes())
  app.route('/v1/admin', adminRoutes())

  app.notFound((context) => {
    const body: ApiErrorBody = {
      error: {
        code: 'NOT_FOUND',
        message: 'No API route matches this path.',
        hint: hintFor('NOT_FOUND'),
      },
    }
    return context.json(body, 404)
  })

  const fetch = app.fetch.bind(app)
  app.fetch = (request, env, executionContext) =>
    fetch(request, env, createInvocationContext(executionContext))
  return app
}

/**
 * Resolve who is calling.
 *
 * Two channels reach this API: a browser session cookie, and a bearer token a
 * harness obtained through the device grant. They resolve to the same account
 * but are not equally trusted — see `requireInteractiveSession` in the domain.
 */
async function resolveActor(container: Container, request: Request): Promise<Actor | undefined> {
  // A failed session read degrades to anonymous rather than failing the request.
  // Browsing and resolving an install plan are anonymous endpoints, so a session
  // store hiccup must not take the catalog down; endpoints that do need an
  // account still reject, because `requireActor` sees no actor. The failure is
  // logged rather than swallowed, so the cause stays visible.
  const session = await readRequestSession(container.auth, request)
  if (!session) return undefined

  const email = session.user.email?.toLowerCase()
  const account = {
    id: session.user.id,
    displayName: session.user.name,
    ...(session.user.email === undefined || session.user.email === null
      ? {}
      : { email: session.user.email }),
    ...(session.user.image === null || session.user.image === undefined
      ? {}
      : { avatarUrl: session.user.image }),
    isAdmin: email !== undefined && container.config.adminEmails.includes(email),
  }

  return { account, channel: session.channel }
}

export type ApiApp = ReturnType<typeof createApiApp>

/** The cutover gates run before opening persistence or reading a session. */
export function catalogRequestPaused(request: Request, env: HubEnv): boolean {
  const url = new URL(request.url)
  // A short cutover maintenance window also blocks GET-side session/catalog writes.
  if (env.CATALOG_WRITES_PAUSED === 'true' && url.pathname !== '/api/health') return true
  return (
    env.CATALOG_SEARCH_PAUSED !== 'false' &&
    (url.searchParams.has('q') ||
      (url.search !== '' &&
        /(?:^|\/)(?:browse|kind|category|artifacts)(?:[/.]|$)/.test(url.pathname)))
  )
}

export function pausedResponse(): Response {
  return new Response(null, {
    status: 503,
    headers: { 'retry-after': '300', 'cache-control': 'no-store' },
  })
}

type BackgroundContext = Pick<ExecutionContext, 'waitUntil' | 'passThroughOnException'>
const invocationTasks = new WeakMap<object, Set<Promise<void>>>()
const invocationParents = new WeakMap<object, BackgroundContext>()

/** Track background work without mutating the platform's shared context. */
export function createInvocationContext<T extends BackgroundContext>(context?: T): T {
  const parent = context ?? {
    waitUntil: (_task: Promise<unknown>) => {},
    passThroughOnException: () => {},
  }
  const tasks = new Set<Promise<void>>()
  const scoped = new Proxy(parent, {
    get(target, property) {
      if (property === 'waitUntil')
        return (task: Promise<unknown>) => {
          const settled = task.then(
            () => {},
            () => {},
          )
          tasks.add(settled)
          void settled.then(() => tasks.delete(settled))
          target.waitUntil(task)
        }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
  invocationTasks.set(scoped, tasks)
  invocationParents.set(scoped, parent)
  return scoped
}

/** Keep request-local persistence alive through body streaming and background work. */
export async function withContainerLifecycle(
  container: Pick<Container, 'dispose'>,
  handle: () => Promise<Response>,
  context: BackgroundContext,
  head = false,
): Promise<Response> {
  let disposal: Promise<void> | undefined
  const dispose = () =>
    (disposal ??= (async () => {
      const tasks = invocationTasks.get(context)
      while (tasks !== undefined && tasks.size > 0) await Promise.all([...tasks])
      await container.dispose()
    })())
  const keepAlive = (task: Promise<void>) =>
    (invocationParents.get(context) ?? context).waitUntil(task)

  try {
    let response = await handle()
    if (head && response.body !== null) {
      await response.body.cancel()
      response = new Response(null, response)
    }
    if (response.body === null) {
      const cleanup = dispose()
      keepAlive(cleanup)
      return response
    }
    const reader = response.body.getReader()
    let finishBody!: () => void
    const bodyFinished = new Promise<void>((resolve) => {
      finishBody = resolve
    })
    const cleanup = bodyFinished.then(dispose)
    keepAlive(cleanup)
    let bodySettled = false
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read()
          if (bodySettled) return
          if (next.done) {
            bodySettled = true
            reader.releaseLock()
            finishBody()
            await cleanup
            controller.close()
          } else {
            controller.enqueue(next.value)
          }
        } catch (error) {
          if (bodySettled) return
          bodySettled = true
          reader.releaseLock()
          finishBody()
          try {
            await cleanup
          } finally {
            controller.error(error)
          }
        }
      },
      async cancel(reason) {
        bodySettled = true
        try {
          await reader.cancel(reason)
        } finally {
          reader.releaseLock()
          finishBody()
          await cleanup
        }
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    const cleanup = dispose()
    keepAlive(cleanup)
    await cleanup
    throw error
  }
}
