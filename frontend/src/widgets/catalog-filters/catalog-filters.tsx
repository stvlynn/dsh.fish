import { Form, useSearchParams } from 'react-router'
import type { FacetsDto } from '@/entities/artifact/model/types'
import { canAddFacetValue, FACET_VALUE_LIMITS } from '@/entities/artifact/model/types'
import { KindIcon } from '@/entities/artifact/ui/kind-icon'
import { CategoryIcon } from '@/entities/artifact/ui/category-icon'
import { useT } from '@/shared/config/i18n'
import { LocaleLink, useLocalePath } from '@/shared/ui/locale-link'
import { cn } from '@/shared/lib/utils'
import { VerifiedIcon } from '@/shared/ui/icon'
import { toggleFilterPath } from './toggle-filter-path'

/**
 * Filter rail.
 *
 * Every control is a link that changes the URL rather than local state, so a
 * filtered view is shareable, back/forward works, and the server renders the
 * same page a crawler sees.
 *
 * Once a facet holds as many values as one query may combine, the unselected
 * choices stop being links. The server would refuse that URL with a 404, and a
 * link nobody can usefully follow is exactly what a crawler walks the catalog
 * through: each toggle was a fresh, uncacheable database query.
 */
export function CatalogFilters({ facets }: { facets: FacetsDto }) {
  const t = useT()
  const localePath = useLocalePath()
  const [params] = useSearchParams()
  const activeKinds = new Set(params.getAll('kind'))
  const activeCategories = new Set(params.getAll('category'))
  const kindsFull = !canAddFacetValue('kinds', activeKinds.size)
  const categoriesFull = !canAddFacetValue('categories', activeCategories.size)

  return (
    <aside className="space-y-7">
      <section>
        <h2 className="text-sm font-medium text-foreground">{t('browse.kind')}</h2>
        <ul className="mt-3 space-y-1">
          {facets.kinds.map((facet) => {
            const active = activeKinds.has(facet.kind)
            const unavailable = !active && kindsFull
            const className = cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-muted font-medium text-foreground'
                : unavailable
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )
            const content = (
              <>
                {/* A selected filter fills its mark. Colour and weight both
                    change, so the pressed state never rests on hue alone. */}
                <KindIcon kind={facet.kind} className="size-4 shrink-0" weight={active ? 'fill' : 'bold'} />
                <span className="flex-1 truncate">{t(facet.labelKey)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{facet.count}</span>
              </>
            )
            return (
              <li key={facet.kind}>
                {unavailable ? (
                  <span
                    aria-disabled="true"
                    title={t('browse.facetLimit', { limit: FACET_VALUE_LIMITS.kinds })}
                    className={className}
                  >
                    {content}
                  </span>
                ) : (
                  <LocaleLink
                    to={toggleFilterPath(params, 'kind', facet.kind)}
                    // Client navigation, not a document load: the click fetches
                    // only this route's data, and the admission layer can tell
                    // an interactive reader from a crawler walking documents.
                    preventScrollReset
                    // The canonical home of this listing is `/kind/<kind>`, which
                    // the footer links and the sitemap carries. A combination
                    // filter is a view of it, not another page.
                    rel="nofollow"
                    aria-pressed={active}
                    title={t(facet.descriptionKey)}
                    className={className}
                  >
                    {content}
                  </LocaleLink>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-foreground">{t('browse.category')}</h2>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {facets.categories.map((category) => {
            const active = activeCategories.has(category.id)
            const unavailable = !active && categoriesFull
            const className = cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
              active
                ? 'border-primary/30 bg-primary/10 text-primary'
                : unavailable
                  ? 'cursor-not-allowed border-border text-muted-foreground/50'
                  : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
            )
            const content = (
              <>
                <CategoryIcon id={category.id} className="size-3.5 shrink-0" weight={active ? 'fill' : 'regular'} />
                {t(category.labelKey)}
              </>
            )
            return (
              <li key={category.id}>
                {unavailable ? (
                  <span
                    aria-disabled="true"
                    title={t('browse.facetLimit', { limit: FACET_VALUE_LIMITS.categories })}
                    className={className}
                  >
                    {content}
                  </span>
                ) : (
                  <LocaleLink
                    to={toggleFilterPath(params, 'category', category.id)}
                    preventScrollReset
                    rel="nofollow"
                    aria-pressed={active}
                    className={className}
                  >
                    {content}
                  </LocaleLink>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <Form method="get" action={localePath('/browse')}>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="verified"
            value="true"
            defaultChecked={params.get('verified') === 'true'}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="size-4 rounded border-border accent-[var(--color-primary)]"
          />
          {/* The same seal the badge uses, so the filter names its target in the
              badge's own mark rather than in words alone. */}
          <VerifiedIcon className="size-4 shrink-0 text-primary" weight="fill" />
          {t('browse.verifiedOnly')}
        </label>
        {/* Preserve the rest of the query when this control submits. */}
        {[...params.entries()]
          .filter(([key]) => key !== 'verified')
          .map(([key, value]) => (
            <input key={`${key}-${value}`} type="hidden" name={key} value={value} />
          ))}
      </Form>
    </aside>
  )
}
