import type { Route } from './+types/not-found-page'
import { useT } from '@/shared/config/i18n'
import { LocaleLink } from '@/shared/ui/locale-link'
import { HomeIcon, UnknownPageIcon } from '@/shared/ui/icon'
import { NotFoundRecovery } from './not-found-recovery'

export function meta(): Route.MetaDescriptors {
  // No canonical, no alternates, no title pattern: this URL is not a document.
  return [{ name: 'robots', content: 'noindex, follow' }]
}

/** Catch-all. Returns a real 404 so crawlers do not index a soft error page. */
export function loader() {
  throw new Response(null, { status: 404, statusText: 'Not Found' })
}

export default function NotFoundPage() {
  const t = useT()

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-xl border border-border bg-card text-muted-foreground"
      >
        <UnknownPageIcon className="size-6" />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="text-muted-foreground">{t('notFound.body')}</p>
      <LocaleLink
        to="/"
        className="press inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        <HomeIcon className="size-4" weight="bold" />
        {t('notFound.home')}
      </LocaleLink>
      <NotFoundRecovery />
    </div>
  )
}
