import { createRequestHandler } from 'react-router'
import { createContainer } from '@dsh-fish/backend/infrastructure/container.js'
import { AgentsReadmeLocalizationScheduler } from '@dsh-fish/backend/infrastructure/agents/agents-readme-localization-scheduler.js'
import type { HubEnv } from '@dsh-fish/backend/infrastructure/config/env.js'
import { catalogRequestPaused, pausedResponse } from '@dsh-fish/backend'
import { LOCALE_CODES } from '@/shared/config/i18n'
import { createSiteHandler } from '../server/handle-request'
import { withEdgeCache } from './edge-cache'
import { withCatalogQueryAdmission } from './catalog-query-admission'
import { scrapeShedResponse, catalogSearchBudgetShed } from './catalog-scrape-gate'

/**
 * The Worker entry. One deployment serves both halves of the product.
 *
 * The API and the UI share an origin deliberately: Better Auth's session cookie
 * then needs no cross-subdomain configuration, the browser makes no preflight
 * request before a search, and a plugin page is server-rendered by code that
 * can call the use cases directly instead of round-tripping through HTTP.
 */
function readmeLocalization(env: HubEnv) {
  if (!env.README_I18N_AGENT) throw new Error('Worker localization requires README_I18N_AGENT.')
  return new AgentsReadmeLocalizationScheduler(env.README_I18N_AGENT, LOCALE_CODES)
}

// Wrangler discovers Durable Object classes from the Worker entry module. The
// exact export name must match `class_name` in wrangler.jsonc.
export { ReadmeI18nAgent } from '@dsh-fish/backend/infrastructure/agents/readme-i18n-agent.js'
export { CatalogQueryAdmission } from '@dsh-fish/backend/infrastructure/catalog-query-admission.js'

const handleRequest = createSiteHandler({
  readmeLocalization,
  requestHandler: createRequestHandler(
    () => import('virtual:react-router/server-build'),
    import.meta.env.MODE,
  ),
})

export default {
  async fetch(request, env, ctx) {
    if (catalogRequestPaused(request, env)) return pausedResponse()

    const shed =
      scrapeShedResponse(request.cf?.asn) ??
      (env.STORAGE_BACKEND === 'mysql'
        ? undefined
        : await catalogSearchBudgetShed(new URL(request.url), env.KV))
    if (shed !== undefined) {
      return withPublicSignals(shed, request)
    }
    return withPublicSignals(
      await withEdgeCache(
        request,
        ctx,
        () => withCatalogQueryAdmission(request, env, () => handleRequest(request, env, ctx)),
        env.STORAGE_BACKEND === 'mysql' ? 'mysql-v1' : '',
      ),
      request,
    )
  },

  /**
   * Cron triggers. The minutely event advances a bounded stock-README
   * backfill; the hourly event refreshes the remote catalog from GitHub, npm
   * and the curated awesome lists, pages a reclassify slice over stored rows,
   * and carries the backfill's stale-failure retry scan so the minutely event
   * does not pay for a full-table read.
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
    // Only an explicit resume can enable cron after production validation.
    if (env.CATALOG_CRON_PAUSED !== 'false' || env.CATALOG_WRITES_PAUSED === 'true') return
    ctx.waitUntil(
      (async () => {
        const container = await createContainer(env, {
          readmeLocalization: readmeLocalization(env),
          supportedLocales: LOCALE_CODES,
        })
        try {
          if (controller.cron !== '* * * * *') {
            // The invocation owns a request-scoped pool; scheduled jobs run serially.
            console.log(
              'catalog_ingest',
              await container.useCases.ingestCatalog.execute({
                limitPerSource: 100,
                limitByOrigin: { github: 200, 'awesome-list': 50 },
              }),
            )
            console.log(
              'catalog_reclassify',
              await container.useCases.reclassifyCatalog.execute({
                limit: 100,
              }),
            )
            await container.useCases.refreshCatalogFacets.execute()
          }
          console.log(
            'readme_i18n_backfill',
            await container.useCases.backfillReadmeLocalization.execute(1, {
              retryStaleFailures: controller.cron !== '* * * * *',
            }),
          )
        } finally {
          await container.dispose()
        }
      })().catch((error: unknown) => {
        console.error('catalog_scheduled_failed', {
          cron: controller.cron,
          error: String(error),
        })
      }),
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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
