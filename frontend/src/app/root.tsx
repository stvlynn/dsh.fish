import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from 'react-router'
import type { Route } from '../+types/root'
import { readThemeCookie, type ThemePreference } from '@/shared/lib/theme'
import { SiteHeader } from '@/widgets/site-header/site-header'
import { SiteFooter } from '@/widgets/site-footer/site-footer'
import { CommunityToasts, readDismissedToasts } from '@/widgets/community-toasts'
import {
  DEFAULT_LOCALE,
  LocaleProvider,
  localizedPath,
  splitLocalePath,
  translate,
  type Locale,
} from '@/shared/config/i18n'
import { documentLanguage } from '@/shared/lib/seo'
import { analyticsIdForDocument, GoogleAnalytics } from '@/shared/lib/analytics'
import { hubContext } from '@/shared/api/hub-context'
import { HomeIcon, IconDefaults } from '@/shared/ui/icon'
import { NotFoundRecovery } from '@/pages/not-found/not-found-recovery'
import './styles/app.css'

export const links: Route.LinksFunction = () => [
  // Google Search ignores favicons under 48×48. Keep 32px for old browsers;
  // 48 and 96 are the sizes the result-page glyph is chosen from.
  { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
  { rel: 'icon', href: '/favicon-48.png', type: 'image/png', sizes: '48x48' },
  { rel: 'icon', href: '/favicon-96.png', type: 'image/png', sizes: '96x96' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap',
  },
]

/**
 * Theme and language, both resolved on the server.
 *
 * The theme is read from a cookie. An inline script that sets a class on
 * <html> cannot work here: React owns the document element during hydration and
 * reconciles its className away, which both reverts the theme and raises a
 * hydration mismatch. A cookie is the only theme store the server can see, so
 * the class is rendered into the HTML and client and server agree from the
 * first byte — no flash, no mismatch.
 *
 * The language is read from the URL, not from a cookie or `Accept-Language`.
 * The URL is the only signal a crawler shares with a reader: a page whose
 * language depends on a request header is one page to an engine and ten to a
 * human, and the nine it cannot see never get indexed.
 *
 * The dismissed community toasts come from a cookie for the theme's reason
 * again: deciding here is what keeps a toast a reader has already closed out
 * of the markup entirely, rather than rendered and then hidden.
 *
 * The GA4 measurement ID is a Worker var, public by design. It is read here
 * rather than baked into the client bundle so a preview without the var ships
 * no gtag, and so local/e2e (`import.meta.env.PROD === false`) cannot pollute
 * production reports. The HTML that carries it is edge-cached anonymously, so
 * the snippet is the same for every visitor of a URL — including crawlers.
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const cookie = request.headers.get('cookie')
  // Client-side navigations fetch this loader at `<path>.data`; the suffix
  // turns `/zh-CN` into the segment `zh-CN.data`, which no longer matches a
  // locale and would silently flip the document to the default language.
  const pathname = url.pathname.replace(/\.data$/, '')
  return {
    theme: readThemeCookie(cookie),
    locale: splitLocalePath(pathname).locale,
    dismissedToasts: readDismissedToasts(cookie),
    gaMeasurementId: analyticsIdForDocument(
      context.get(hubContext).env.GA_MEASUREMENT_ID,
      import.meta.env.PROD,
    ),
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root')
  const theme: ThemePreference = data?.theme ?? 'system'
  const locale: Locale = data?.locale ?? DEFAULT_LOCALE
  const gaMeasurementId = data?.gaMeasurementId
  const { lang, dir } = documentLanguage(locale)

  return (
    <html lang={lang} dir={dir} className={theme === 'system' ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <Links />
        {gaMeasurementId ? <GoogleAnalytics measurementId={gaMeasurementId} /> : null}
      </head>
      <body className="min-h-screen">
        <IconDefaults>
          <LocaleProvider locale={locale}>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
            >
              {translate(locale, 'a11y.skipToContent')}
            </a>
            {children}
          </LocaleProvider>
        </IconDefaults>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  const data = useRouteLoaderData<typeof loader>('root')
  const { pathname } = useLocation()
  const { path } = splitLocalePath(pathname.replace(/\.data$/, ''))
  // Plugin pages keep the footer inside the ask layout's main column so it
  // stays on that surface when the Q&A pane is open, instead of dropping out
  // under both columns.
  const footerInPage = /^\/a\/[^/]+\/?$/.test(path)

  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <SiteHeader />
      <main id="main" className="min-w-0 flex-1">
        <Outlet />
      </main>
      {footerInPage ? null : <SiteFooter />}
      <CommunityToasts dismissed={data?.dismissedToasts ?? []} />
    </div>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const data = useRouteLoaderData<typeof loader>('root')
  const locale: Locale = data?.locale ?? DEFAULT_LOCALE
  const isNotFound = isRouteErrorResponse(error) && error.status === 404
  const title = isNotFound ? translate(locale, 'notFound.title') : translate(locale, 'common.error')
  const body = isNotFound ? translate(locale, 'notFound.body') : translate(locale, 'common.error')

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      <a
        href={localizedPath(locale, '/')}
        className="press inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        <HomeIcon className="size-4" weight="bold" />
        {translate(locale, 'notFound.home')}
      </a>
      {isNotFound ? <NotFoundRecovery /> : null}
    </div>
  )
}
