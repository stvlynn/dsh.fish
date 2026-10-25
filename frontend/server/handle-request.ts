import { RouterContextProvider } from 'react-router'
import { createApiApp, createInvocationContext, withContainerLifecycle } from '@dsh-fish/backend'
import { createContainer } from '@dsh-fish/backend/infrastructure/container.js'
import type { HubEnv } from '@dsh-fish/backend/infrastructure/config/env.js'
import { hubContext } from '@/shared/api/hub-context'
import {
  canonicalLocaleRedirect,
  LOCALE_CODES,
  preferredLocaleRedirect,
  splitLocalePath,
} from '@/shared/config/i18n'
import { withDiscoveryLinks } from '@/shared/api/agent-discovery'
import {
  maybeMarkdownResponse,
  notFoundMarkdownResponse,
  shouldServeMarkdownNotFound,
  supportsMarkdownNegotiation,
} from '@/pages/markdown'
import { retiredCategoryRedirect } from '@/shared/lib/retired-category-path'
import { retiredKindRedirect, retiredPublishDocsRedirect } from '@/shared/lib/retired-kind-path'

import type { ContainerOptions } from '@dsh-fish/backend/infrastructure/container.js'
import type { ReadmeLocalizationScheduler } from '@dsh-fish/backend/application/port/readme-localization.js'

/** Shared routing and SSR orchestration; runtime adapters own storage and delivery. */
export function createSiteHandler(options: {
  context?: typeof hubContext
  requestHandler: (request: Request, context: RouterContextProvider) => Promise<Response>
  readmeLocalization: (env: HubEnv) => ReadmeLocalizationScheduler
  containerOptions?: Pick<ContainerOptions, 'persistence' | 'ada'>
}) {
  const api = createApiApp(options)
  const requestHandler = options.requestHandler
  const readmeLocalization = options.readmeLocalization
  return async function handleRequest(
    request: Request,
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

    // Retired category slugs fold onto the live taxonomy before preferred-locale
    // 302s, so `/category/coding` becomes `/category/git` rather than
    // `/ja/category/coding` and then a later 404.
    const retiredCategory = retiredCategoryRedirect(url.pathname, url.search)
    if (retiredCategory !== undefined) {
      return Response.redirect(new URL(retiredCategory, url.origin).toString(), 301)
    }

    const retiredKind = retiredKindRedirect(url.pathname, url.search)
    if (retiredKind !== undefined) {
      return Response.redirect(new URL(retiredKind, url.origin).toString(), 301)
    }

    const retiredDocs = retiredPublishDocsRedirect(url.pathname, url.search)
    if (retiredDocs !== undefined) {
      return Response.redirect(new URL(retiredDocs, url.origin).toString(), 301)
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
    // calls persistence directly rather than making an HTTP request to itself.
    const container = await createContainer(env, {
      ...options.containerOptions,
      cf: request.cf as IncomingRequestCfProperties | undefined,
      readmeLocalization: readmeLocalization(env),
      supportedLocales: LOCALE_CODES,
    })

    const invocationContext = createInvocationContext(ctx)
    return withContainerLifecycle(
      container,
      async () => {
        // Agents get the catalog as markdown when they ask for it (`Accept:
        // text/markdown`) or follow a `.md` alias; browsers on HTML URLs never
        // send that type, so nothing changes for them.
        const markdown = await maybeMarkdownResponse(request, container)
        if (markdown !== null) {
          return withDiscoveryLinks(markdown, request.url, false)
        }

        const routerContext = new RouterContextProvider()
        routerContext.set(options.context ?? hubContext, {
          container,
          env,
          ctx: invocationContext,
        })

        const response = await requestHandler(request, routerContext)

        // A missing HTML path stays a real 404. Agents that asked for markdown —
        // or that sent curl's default `*/*` — get a short recovery map instead of
        // the HTML error page, so they can find llms.txt, the sitemap, and the API.
        if (response.status === 404 && shouldServeMarkdownNotFound(request)) {
          await response.body?.cancel()
          const { locale } = splitLocalePath(url.pathname)
          return withDiscoveryLinks(
            notFoundMarkdownResponse(container.config.baseUrl, locale),
            request.url,
            false,
          )
        }

        // Agent discovery (RFC 8288 / RFC 9727 / llms.txt v2): HTML documents name
        // their machine-readable counterparts in Link headers, so an agent never
        // has to parse markup to find the api-catalog, the OpenAPI document, the
        // covering llms.txt, or the markdown alias of the page it is already reading.
        return withDiscoveryLinks(response, request.url, supportsMarkdownNegotiation(url.pathname))
      },
      invocationContext,
      request.method === 'HEAD',
    )
  }
}
