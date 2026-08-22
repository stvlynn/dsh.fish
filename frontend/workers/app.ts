import { createRequestHandler, RouterContextProvider } from 'react-router'
import { createApiApp } from '@dsh-fish/backend'
import { createContainer } from '@dsh-fish/backend/infrastructure/container.js'
import { AgentsReadmeLocalizationScheduler } from '@dsh-fish/backend/infrastructure/agents/agents-readme-localization-scheduler.js'
import type { HubEnv } from '@dsh-fish/backend/infrastructure/config/env.js'
import { hubContext } from '@/shared/api/hub-context'
import { canonicalLocaleRedirect, LOCALE_CODES, preferredLocaleRedirect } from '@/shared/config/i18n'
import { withDiscoveryLinks } from '@/shared/api/agent-discovery'
import { maybeMarkdownResponse, supportsMarkdownNegotiation } from '@/pages/markdown'
import { withEdgeCache } from './edge-cache'

/**
 * The Worker entry. One deployment serves both halves of the product.
 *
 * The API and the UI share an origin deliberately: Better Auth's session cookie
 * then needs no cross-subdomain configuration, the browser makes no preflight
 * request before a search, and a plugin page is server-rendered by code that
 * can call the use cases directly instead of round-tripping through HTTP.
 */
function readmeLocalization(env: HubEnv) {
  return new AgentsReadmeLocalizationScheduler(env.README_I18N_AGENT, LOCALE_CODES)
}

const api = createApiApp({ readmeLocalization })

// Wrangler discovers Durable Object classes from the Worker entry module. The
// exact export name must match `class_name` in wrangler.jsonc.
export { ReadmeI18nAgent } from '@dsh-fish/backend/infrastructure/agents/readme-i18n-agent.js'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

async function handleRequest(
  request: Request<unknown, IncomingRequestCfProperties<unknown>>,
  env: HubEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/')) {
    return api.fetch(request, env, ctx)
  }

  // IndexNow key verification. The filename *is* the key, so this cannot be
  // a React Router route: route parameters only match whole path segments,
  // and `indexnow-<key>.txt` has the key inline. Unset key, or a wrong one,
  // is a plain 404 — the file's existence proves ownership of the host, so
  // it must exist exactly when the key is configured.
  if (env.INDEXNOW_KEY !== undefined && url.pathname === `/indexnow-${env.INDEXNOW_KEY}.txt`) {
    return new Response(`${env.INDEXNOW_KEY}\n`, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      },
    })
  }

  // One document, one URL. `/en/browse` duplicates `/browse`, and `/ZH-cn`
  // duplicates `/zh-CN` to a router that matches case-insensitively; both are
  // folded into the canonical form before routing, permanently, so a crawler
  // that ever saw the other form drops it.
  const canonical = canonicalLocaleRedirect(url.pathname, url.search)
  if (canonical !== undefined) {
    return Response.redirect(new URL(canonical, url.origin).toString(), 301)
  }

  // A reader who once picked a language is forwarded to it on bare-URL
  // visits. Temporary: a preference is not a move, and the 302 keeps both the
  // edge cache and crawlers (which hold no cookie) out of it.
  const preferred = preferredLocaleRedirect(
    url.pathname,
    url.search,
    request.headers.get('cookie'),
    request.headers.get('accept'),
  )
  if (preferred !== undefined) {
    return Response.redirect(new URL(preferred, url.origin).toString(), 302)
  }

  // Loaders resolve use cases in-process. A server-rendered page therefore
  // costs one D1 round trip, not an HTTP hop back into the same Worker.
  const container = createContainer(env, {
    cf: request.cf,
    readmeLocalization: readmeLocalization(env),
    supportedLocales: LOCALE_CODES,
  })

  // Agents get the catalog as markdown when they ask for it (`Accept:
  // text/markdown`) or follow a `.md` alias; browsers on HTML URLs never
  // send that type, so nothing changes for them.
  const markdown = await maybeMarkdownResponse(request, container)
  if (markdown !== null) {
    return withDiscoveryLinks(markdown, request.url, false)
  }

  const routerContext = new RouterContextProvider()
  routerContext.set(hubContext, {
    container,
    env,
    ctx,
  })

  const response = await requestHandler(request, routerContext)

  // Agent discovery (RFC 8288 / RFC 9727 / llms.txt v2): HTML documents name
  // their machine-readable counterparts in Link headers, so an agent never
  // has to parse markup to find the api-catalog, the OpenAPI document, the
  // covering llms.txt, or the markdown alias of the page it is already reading.
  return withDiscoveryLinks(response, request.url, supportsMarkdownNegotiation(url.pathname))
}

export default {
  async fetch(request, env, ctx) {
    return withPublicSignals(
      await withEdgeCache(request, ctx, () => handleRequest(request, env, ctx)),
      request,
    )
  },

  /**
   * Cron triggers. The minutely event advances a bounded stock-README
   * backfill; the hourly event refreshes the remote catalog from GitHub, npm
   * and the curated awesome lists, and carries the backfill's stale-failure
   * retry scan so the minutely event does not pay for a full-table read.
   *
   * The limits are a subrequest budget, not a taste: a Worker invocation may
   * make 1000 subrequests, and one run costs roughly 200 GitHub repositories ×
   * up to 3 probes (plus 2 search pages and a handful of extra reads per
   * repository that actually classifies), 100 npm packages × 2, and 50 listed
   * repositories × (1 metadata read + up to 3 probes). The GitHub sweeps resume
   * from a stored position each run rather than re-reading the head, so the
   * whole reachable result set is covered across runs.
   */
  async scheduled(controller, env, ctx) {
    const container = createContainer(env, {
      readmeLocalization: readmeLocalization(env),
      supportedLocales: LOCALE_CODES,
    })

    if (controller.cron === '* * * * *') {
      ctx.waitUntil(
        container.useCases.backfillReadmeLocalization
          // The stale-failure rescan reads every README-bearing row; the
          // hourly branch below pays for it once an hour instead.
          .execute(undefined, { retryStaleFailures: false })
          .then((report) => {
            console.log('readme_i18n_backfill', report)
          })
          .catch((error: unknown) => {
            console.error('readme_i18n_backfill_failed', String(error))
          }),
      )
      return
    }

    ctx.waitUntil(
      Promise.all([
        container.useCases.ingestCatalog
          .execute({
            limitPerSource: 100,
            limitByOrigin: { github: 200, 'awesome-list': 50 },
          })
          .then((report) => {
            console.log('catalog_ingest', report)
          })
          .catch((error: unknown) => {
            console.error('catalog_ingest_failed', String(error))
          }),
        container.useCases.backfillReadmeLocalization
          // The off-peak DeepSeek leg is paid but cheap and unconstrained by
          // the Go quota, so the stale-failure scan can run a large batch.
          .execute(100)
          .then((report) => {
            console.log('readme_i18n_backfill', report)
          })
          .catch((error: unknown) => {
            console.error('readme_i18n_backfill_failed', String(error))
          }),
      ]),
    )
  },
} satisfies ExportedHandler<HubEnv>

function withPublicSignals(response: Response, request: Request): Response {
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
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
