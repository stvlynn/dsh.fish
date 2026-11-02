import { isExpensiveCatalogRequest } from '../workers/catalog-query-admission'
import { exceededFacet } from '@/entities/artifact/model/types'
import { splitLocalePath } from '@/shared/config/i18n'

/**
 * Which share of the catalog's query capacity a request draws from.
 *
 * - `interactive` — a script on an already-loaded page asking for data: React
 *   Router's client navigation (`<path>.data`), the header search palette, the
 *   `@dsh-fish/hub` plugin and CLI calling `/api/v1/artifacts`, or any
 *   credentialed request.
 * - `document` — an anonymous top-level page load.
 *
 * Production traffic made the split necessary. A distributed crawler sent
 * every one of its requests as a document load, from hundreds of addresses at a
 * few requests each, and drained the single shared budget, so a person's search
 * failed about nine times in ten. A reserved interactive share means a reader
 * who already has the site open is never competing with that crawl.
 *
 * This is a fairness hint, not a security boundary. A browser sets fetch
 * metadata and a page cannot forge it, but anything outside a browser can send
 * any header. A crawler that learns to claim `interactive` moves into a smaller,
 * separately bounded share; it gains nothing it could not get by other means,
 * and the facet bound and per-address limits still apply to it.
 */
export type AdmissionClass = 'interactive' | 'document'

/**
 * What the admission layer does with a request before any database work.
 *
 * - `bypass` — no costly catalog query will run: either the route is cheap, or
 *   the facet union is over its bound and the handler answers 404/400 without
 *   querying. Waiting for a slot would only take one from someone else.
 * - `admit` — a costly query; it must hold a slot of its class first.
 */
export type AdmissionDecision =
  | { readonly kind: 'bypass' }
  | { readonly kind: 'admit'; readonly class: AdmissionClass }

/** Decide, from the request alone, whether and how a catalog query is admitted. */
export function admissionDecision(request: Request): AdmissionDecision {
  if (!isExpensiveCatalogRequest(request)) return { kind: 'bypass' }
  const { pathname, searchParams } = new URL(request.url)
  const { path } = splitLocalePath(pathname.replace(/\.(?:data|md)$/, ''))
  const catalogApi = path === '/api/v1/artifacts'
  const browse = path === '/browse' || path === '/browse/'
  // Only bypass a handler that actually rejects this selection. Canonical
  // /kind, /category and /for loaders use their path filter and ignore query
  // facets, so query noise must never remove their database admission.
  // Markdown browse validates kinds/categories, but does not consume topics.
  const rejectedWithoutQuery =
    (catalogApi || browse) &&
    exceededFacet({
      kinds: searchParams.getAll('kind'),
      categories: searchParams.getAll('category'),
      ...(catalogApi ? { topics: searchParams.getAll('topic') } : {}),
    }) !== undefined
  if (rejectedWithoutQuery) return { kind: 'bypass' }
  return { kind: 'admit', class: admissionClass(request) }
}

/** The share a costly catalog request draws from. */
export function admissionClass(request: Request): AdmissionClass {
  if (request.headers.has('cookie') || request.headers.has('authorization')) return 'interactive'
  const mode = request.headers.get('sec-fetch-mode')
  // A browser sends `navigate` only for a top-level page load. Every request a
  // loaded page makes for data — fetch, client navigation — is `cors` or
  // `same-origin` (verified against Chromium: `.data` and `/api/` fetches carry
  // `cors`/`empty`). A client with no fetch metadata at all — an HTTP library,
  // the plugin, the CLI — counts as interactive only when it asks the API or a
  // `.data` endpoint for data, never for a whole page.
  if (mode !== null) return mode === 'navigate' ? 'document' : 'interactive'
  const { pathname } = new URL(request.url)
  return pathname.startsWith('/api/') || pathname.endsWith('.data') ? 'interactive' : 'document'
}
