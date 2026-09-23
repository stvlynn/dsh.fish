import { Form } from 'react-router'
import type { Route } from './+types/home-page'
import { hubContext } from '@/shared/api/hub-context'
import { CatalogGrid } from '@/widgets/catalog-grid/catalog-grid'
import { KindIcon } from '@/entities/artifact/ui/kind-icon'
import { kindDescriptionKey, kindPluralKey } from '@/entities/artifact/model/types'
import { ForwardIcon, SearchIcon } from '@/shared/ui/icon'
import { requireLocale, translate, useT } from '@/shared/config/i18n'
import { LocaleLink, useLocalePath } from '@/shared/ui/locale-link'
import { errorMeta, organizationLd, pageMeta, websiteLd } from '@/shared/lib/seo'
import { AnimatedNumber } from '@/shared/ui/animated-number'

export function meta({ loaderData, params }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData) return errorMeta(params.locale)
  const { origin, locale } = loaderData
  return pageMeta({
    origin,
    locale,
    path: '/',
    title: translate(locale, 'seo.home.title', {
      name: translate(locale, 'app.name'),
      tagline: translate(locale, 'app.tagline'),
    }),
    description: translate(locale, 'app.description'),
    // The site-level nodes are emitted once, here, and referenced by `@id`
    // from every other page rather than repeated on each of them.
    jsonLd: [websiteLd(origin, locale), organizationLd(origin, locale)],
  })
}

/**
 * Server-side data for the landing page.
 *
 * Four reads in parallel rather than in sequence: D1 round trips dominate the
 * response, so serializing them would multiply the page's time to first byte
 * for no reason.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  const locale = requireLocale(params.locale)
  const { container } = context.get(hubContext)
  const { searchArtifacts, listCatalogFacets } = container.useCases

  const [trending, risingPool, recentPool, facets] = await Promise.all([
    searchArtifacts.execute({ sort: 'popular', limit: 6, locale }),
    // Over-fetch, then subtract what the first rail already shows. Two rails
    // listing the same artifacts is the same page twice.
    searchArtifacts.execute({ sort: 'rising', limit: 12, locale }),
    searchArtifacts.execute({ sort: 'recent', limit: 12, locale }),
    listCatalogFacets.execute(),
  ])

  const shown = new Set(trending.items.map((item) => item.id))
  // A zero velocity is an unmeasured artifact, not a rising one, and a rail of
  // those would only repeat the trending list in a different order.
  const rising = risingPool.items
    .filter((item) => item.starVelocity7d > 0 && !shown.has(item.id))
    .slice(0, 3)
  for (const item of rising) shown.add(item.id)
  const recent = recentPool.items.filter((item) => !shown.has(item.id)).slice(0, 3)

  return { trending, rising, recent, facets, locale, origin: container.config.baseUrl }
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const { trending, rising, recent, facets } = loaderData
  const t = useT()
  const localePath = useLocalePath()
  const total = facets.kinds.reduce((sum, facet) => sum + facet.count, 0)

  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        {/* A single soft wash, not a full-bleed gradient: it gives the hero
            depth without turning the page into a marketing landing. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center sm:py-24">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            {t('home.heroTitle')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            {t('home.heroSubtitle')}
          </p>

          <Form
            action={localePath('/browse')}
            method="get"
            className="mx-auto mt-8 flex max-w-lg gap-2"
          >
            <div className="relative flex-1">
              <SearchIcon
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                name="q"
                aria-label={t('nav.search')}
                placeholder={t('home.searchPlaceholder')}
                className="h-12 w-full rounded-lg border border-border bg-card pl-11 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong"
              />
            </div>
            <button
              type="submit"
              className="press inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground"
            >
              <SearchIcon className="size-4" weight="bold" />
              {t('home.searchAction')}
            </button>
          </Form>

          <p className="mt-7 text-sm text-muted-foreground">
            <AnimatedNumber value={total} /> {t('home.statsArtifacts')}
          </p>

          {/* Each chip goes to that type's own indexable page rather than to a
              `?kind=` filter, so the site's most linked-to internal pages are
              the ones a crawler can rank. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {facets.kinds.map((facet) => (
              <LocaleLink
                key={facet.kind}
                to={`/kind/${facet.kind}`}
                title={t(kindDescriptionKey(facet.kind))}
                className="press inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-border-strong hover:text-foreground"
              >
                <KindIcon kind={facet.kind} className="size-4 shrink-0" />
                {t(kindPluralKey(facet.kind))}
                <span className="tabular-nums opacity-60">{facet.count}</span>
              </LocaleLink>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-14 px-6 py-16">
        <Rail title={t('home.trending')} to="/browse?sort=popular" linkKey="home.browseAll">
          <CatalogGrid artifacts={trending.items} />
        </Rail>

        {rising.length > 0 ? (
          <Rail title={t('home.rising')} to="/browse?sort=rising" linkKey="home.seeRising">
            <CatalogGrid artifacts={rising} />
          </Rail>
        ) : null}

        {recent.length > 0 ? (
          <Rail title={t('home.recentlyUpdated')} to="/browse?sort=recent" linkKey="home.seeRecent">
            <CatalogGrid artifacts={recent} />
          </Rail>
        ) : null}
      </div>
    </>
  )
}

function Rail({
  title,
  to,
  linkKey,
  children,
}: {
  title: string
  to: string
  linkKey: string
  children: React.ReactNode
}) {
  const t = useT()
  return (
    <section>
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <LocaleLink
          to={to}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t(linkKey)}
          <ForwardIcon className="size-3.5" weight="bold" />
        </LocaleLink>
      </div>
      {children}
    </section>
  )
}
