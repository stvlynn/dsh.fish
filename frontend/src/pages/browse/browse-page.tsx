import { Form, useSearchParams } from 'react-router'
import type { Route } from './+types/browse-page'
import { hubContext } from '@/shared/api/hub-context'
import { CatalogGrid } from '@/widgets/catalog-grid/catalog-grid'
import { CatalogFilters } from '@/widgets/catalog-filters/catalog-filters'
import { CatalogPagination } from '@/widgets/catalog-pagination/catalog-pagination'
import { requireLocale, translate, useT } from '@/shared/config/i18n'
import { useLocalePath } from '@/shared/ui/locale-link'
import { breadcrumbLd, collectionLd, errorMeta, pageMeta } from '@/shared/lib/seo'
import { SearchIcon, SortIcon } from '@/shared/ui/icon'

const PAGE_SIZE = 24

/**
 * Search and faceted browse.
 *
 * Only the bare `/browse` is offered to the index. Every query — a search term,
 * a filter combination, a page offset — produces a near-duplicate of a listing
 * that is already reachable at `/kind/<kind>` or `/category/<category>`, and a
 * catalog of thousands can mint effectively unlimited such URLs. They stay
 * `noindex, follow`: a crawler still walks through them to the plugin pages
 * they link to, which is the only thing worth reaching here.
 */
export function meta({ loaderData, params }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData) return errorMeta(params.locale)
  const { origin, locale, filtered, results, query } = loaderData
  const title = query
    ? `${translate(locale, 'browse.searchTitle', { query })} — ${translate(locale, 'app.name')}`
    : translate(locale, 'browse.pageTitle')

  return pageMeta({
    origin,
    locale,
    path: '/browse',
    title,
    description: translate(locale, 'seo.browse.description'),
    index: !filtered,
    jsonLd: filtered
      ? []
      : [
          breadcrumbLd(origin, locale, [
            { name: translate(locale, 'app.name'), path: '/' },
            { name: translate(locale, 'browse.title'), path: '/browse' },
          ]),
          collectionLd(origin, locale, {
            path: '/browse',
            name: translate(locale, 'browse.title'),
            description: translate(locale, 'seo.browse.description'),
            items: results.items.map((item) => ({
              name: item.displayName,
              path: `/a/${item.id}`,
            })),
          }),
        ],
  })
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const locale = requireLocale(params.locale)
  const url = new URL(request.url)
  const { container } = context.get(hubContext)
  const query = url.searchParams.get('q') ?? ''

  const [results, facets] = await Promise.all([
    container.useCases.searchArtifacts.execute({
      locale,
      ...(query === '' ? {} : { text: query }),
      kinds: url.searchParams.getAll('kind'),
      categories: url.searchParams.getAll('category'),
      ...(url.searchParams.get('sort') ? { sort: url.searchParams.get('sort')! } : {}),
      ...(url.searchParams.get('verified') === 'true' ? { verifiedOnly: true } : {}),
      limit: PAGE_SIZE,
      offset: Number(url.searchParams.get('offset') ?? 0),
    }),
    container.useCases.listCatalogFacets.execute(),
  ])

  return {
    results,
    facets,
    locale,
    query,
    origin: container.config.baseUrl,
    // Any narrowing at all makes this a view of the catalog rather than the
    // catalog, and views are not what gets indexed.
    filtered: [...url.searchParams.keys()].length > 0,
  }
}

export default function BrowsePage({ loaderData }: Route.ComponentProps) {
  const { results, facets } = loaderData
  const t = useT()
  const localePath = useLocalePath()
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {query ? t('browse.searchTitle', { query }) : t('browse.title')}
        </h1>
        <Form method="get" action={localePath('/browse')} className="mt-4 flex flex-wrap gap-2">
          {/* `basis-full` below `sm`: the sort select and the submit button take
              close to 300px between them, which on a phone leaves the field too
              narrow to read a query back in. Its own row above them instead. */}
          <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <SearchIcon
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              name="q"
              defaultValue={query}
              aria-label={t('nav.search')}
              placeholder={t('home.searchPlaceholder')}
              className="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong"
            />
          </div>
          {/* The glyph sits inside the control's box rather than beside it, so
              the row keeps three fields and not five. The native disclosure
              arrow stays: it is the only thing that says "this is a select". */}
          <div className="relative">
            <SortIcon
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <select
              name="sort"
              defaultValue={params.get('sort') ?? ''}
              aria-label={t('browse.sort')}
              className="h-11 rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none"
            >
              <option value="">{t('browse.sort.relevance')}</option>
              <option value="popular">{t('browse.sort.popular')}</option>
              <option value="rising">{t('browse.sort.rising')}</option>
              <option value="recent">{t('browse.sort.recent')}</option>
              <option value="name">{t('browse.sort.name')}</option>
            </select>
          </div>
          {/* Filters chosen in the rail must survive a re-search. */}
          {params.getAll('kind').map((kind) => (
            <input key={`kind-${kind}`} type="hidden" name="kind" value={kind} />
          ))}
          {params.getAll('category').map((category) => (
            <input key={`cat-${category}`} type="hidden" name="category" value={category} />
          ))}
          <button
            type="submit"
            className="press inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            <SearchIcon className="size-4" weight="bold" />
            {t('home.searchAction')}
          </button>
        </Form>
      </header>

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        <CatalogFilters facets={facets} />

        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            <span className="tabular-nums">{results.total}</span> {t('browse.resultCount')}
          </p>
          <CatalogGrid artifacts={results.items} />
          <CatalogPagination
            basePath="/browse"
            total={results.total}
            limit={results.limit}
            offset={results.offset}
          />
        </div>
      </div>
    </div>
  )
}
