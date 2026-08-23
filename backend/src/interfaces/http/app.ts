import { Hono } from 'hono'
import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'
import type { Actor } from '../../domain/account/account.js'
import { createContainer } from '../../infrastructure/container.js'
import type { Container } from '../../infrastructure/container.js'
import type { HubEnv } from '../../infrastructure/config/env.js'
import type { ReadmeLocalizationScheduler } from '../../application/port/readme-localization.js'
import { hintFor, toApiError, type ApiErrorBody } from './error-mapper.js'
import { isDomainError } from '../../domain/shared/error.js'
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
 * `domain`, which is what lets the `dsh-hub` plugin and the website share
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
    const container = createContainer(context.env, {
      cf: context.req.raw.cf as IncomingRequestCfProperties,
      readmeLocalization: options.readmeLocalization(context.env),
    })
    context.set('container', container)
    context.set('actor', await resolveActor(container, context.req.raw))
    await next()
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
  // session reads, and the device grant the `dsh-hub` plugin polls.
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
  let session: Awaited<ReturnType<Container['auth']['api']['getSession']>>
  try {
    session = await container.auth.api.getSession({ headers: request.headers })
  } catch (error) {
    console.error('session_resolution_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
  if (!session?.user) return undefined

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

  const channel = request.headers.get('authorization')?.toLowerCase().startsWith('bearer ')
    ? ('device-token' as const)
    : ('session' as const)

  return { account, channel }
}

export type ApiApp = ReturnType<typeof createApiApp>
