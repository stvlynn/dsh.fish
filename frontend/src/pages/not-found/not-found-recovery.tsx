import { useT } from '@/shared/config/i18n'
import { LocaleLink } from '@/shared/ui/locale-link'

/**
 * Where to look next after a real 404.
 *
 * The heading and home button already say the page is missing. This list is
 * the recovery map: sitemap, llms.txt, docs, OpenAPI, catalog API. Shared by
 * the catch-all page and the root error boundary so both HTML 404s agree.
 */
export function NotFoundRecovery() {
  const t = useT()

  return (
    <nav aria-label={t('notFound.next')} className="mt-8 w-full max-w-sm text-left">
      <h2 className="text-sm font-medium text-foreground">{t('notFound.next')}</h2>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>
          <a href="/sitemap.xml" className="underline-offset-4 hover:text-foreground hover:underline">
            {t('notFound.sitemap')}
          </a>
        </li>
        <li>
          <a href="/llms.txt" className="underline-offset-4 hover:text-foreground hover:underline">
            {t('notFound.llms')}
          </a>
        </li>
        <li>
          <LocaleLink to="/docs" className="underline-offset-4 hover:text-foreground hover:underline">
            {t('notFound.docs')}
          </LocaleLink>
        </li>
        <li>
          <LocaleLink
            to="/docs/developers"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('notFound.developers')}
          </LocaleLink>
        </li>
        <li>
          <a href="/openapi.json" className="underline-offset-4 hover:text-foreground hover:underline">
            {t('notFound.openapi')}
          </a>
        </li>
        <li>
          <a
            href="/api/v1/artifacts"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('notFound.api')}
          </a>
        </li>
      </ul>
    </nav>
  )
}
