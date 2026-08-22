import { index, route, type RouteConfig } from '@react-router/dev/routes'

/**
 * Route table.
 *
 * Paths are relative to `appDirectory` (`src`), so each entry points at the
 * `pages` slice that owns it. A page composes widgets and features and reads
 * routing data — it holds no business logic of its own.
 *
 * ## Languages
 *
 * Every reader-facing route carries an optional `:locale?` first segment, so
 * one route module serves `/browse` (the default language, unprefixed) and
 * `/ja/browse` alike. An optional segment matches *any* first segment, so each
 * loader passes it through `requireLocale`, which 404s anything that is not a
 * language rather than serving the same page under an unbounded set of URLs.
 *
 * ## Crawlable facets
 *
 * `/kind/:kind` and `/category/:category` exist because `/browse?kind=skill` is
 * a query string: engines crawl those reluctantly, rank them poorly, and cannot
 * tell a filter apart from a session id. The same listing under a real path is
 * an indexable landing page for the term people actually search for.
 */
export default [
  index('./pages/home/home-page.tsx'),
  // The home page again, one level down: `/ja`, `/de`. `index()` takes no path,
  // so the localized root needs its own entry and its own id.
  route(':locale', './pages/home/home-page.tsx', { id: 'home-localized' }),

  route(':locale?/browse', './pages/browse/browse-page.tsx'),
  route(':locale?/kind/:kind', './pages/kind/kind-page.tsx'),
  route(':locale?/category/:category', './pages/category/category-page.tsx'),
  route(':locale?/for/:topic', './pages/topic/topic-page.tsx'),
  route(':locale?/a/:artifactId', './pages/artifact-detail/artifact-detail-page.tsx'),
  // Per-artifact assets. No locale prefix: one bitmap and one badge serve every
  // language variant of the page — the text next to them stays localized in
  // the page head and in the README that embeds them.
  route('a/:artifactId/og.png', './pages/artifact-og/og-image.tsx'),
  route('a/:artifactId/badge.svg', './pages/artifact-badge/badge.svg.ts'),
  route(':locale?/submit', './pages/submit/submit-page.tsx'),
  route(':locale?/dashboard', './pages/dashboard/dashboard-page.tsx'),
  route(':locale?/sign-in', './pages/sign-in/sign-in-page.tsx'),
  // The device grant's verification page. `verification_uri_complete` links
  // straight here with the code prefilled.
  route(':locale?/device', './pages/device/device-page.tsx'),
  route(':locale?/docs/search', './pages/docs/search.ts'),
  // Agent overviews for the docs tree. Before the splat so `llms.txt` is not
  // treated as a missing MDX slug.
  route('docs/llms.txt', './pages/seo/docs-llms-txt.ts'),
  route('docs/llms-full.txt', './pages/seo/docs-llms-full.ts'),
  route(':locale?/docs', './pages/docs/docs-page.tsx'),
  route(':locale?/docs/*', './pages/docs/docs-page.tsx', { id: 'docs-splat' }),

  // Crawler-facing resources. No locale prefix: there is one robots.txt per
  // origin, and one sitemap set that lists every language of every URL.
  route('robots.txt', './pages/seo/robots.ts'),
  route('sitemap.xml', './pages/seo/sitemap-index.ts'),
  route('sitemaps/pages.xml', './pages/seo/pages-sitemap.ts'),
  route('sitemaps/artifacts/:page', './pages/seo/artifacts-sitemap.ts'),
  // Atom feeds are localized: the default language is unprefixed like every
  // other reader-facing route, the other nine live under their prefix.
  route(':locale?/feed.xml', './pages/seo/feed.ts'),
  // Agent-discovery resources. The api-catalog (RFC 9727), the OpenAPI
  // document, and llms.txt (llmstxt.org v2) are what the HTML pages' `Link`
  // headers point at.
  route('.well-known/api-catalog', './pages/seo/api-catalog.ts'),
  route('openapi.json', './pages/seo/openapi.ts'),
  route('llms.txt', './pages/seo/llms-txt.ts'),

  route('*', './pages/not-found/not-found-page.tsx'),
] satisfies RouteConfig
