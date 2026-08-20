import { useSearchParams } from 'react-router'
import type { Route } from './+types/sign-in-page'
import { hubContext } from '@/shared/api/hub-context'
import { authClient } from '@/shared/api/auth-client'
import { requireLocale, translate, useT } from '@/shared/config/i18n'
import { LocaleLink } from '@/shared/ui/locale-link'
import { errorMeta, pageMeta } from '@/shared/lib/seo'
import { GithubIcon, HomeIcon } from '@/shared/ui/icon'

/**
 * Never indexed: an account page has nothing a search result should lead to.
 * `follow` still applies, so the links out of it are not dead ends.
 */
export function meta({ loaderData, params }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData) return errorMeta(params.locale)
  const { origin, locale } = loaderData
  return pageMeta({
    origin,
    locale,
    path: '/sign-in',
    title: `${translate(locale, 'auth.signInTitle')} — ${translate(locale, 'app.name')}`,
    description: translate(locale, 'auth.signInSubtitle'),
    index: false,
  })
}

export function loader({ context, params }: Route.LoaderArgs) {
  return {
    locale: requireLocale(params.locale),
    origin: context.get(hubContext).container.config.baseUrl,
  }
}

export default function SignInPage() {
  const t = useT()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') ?? '/dashboard'

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.signInTitle')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('auth.signInSubtitle')}</p>

      <button
        type="button"
        onClick={() => void authClient.signIn.social({ provider: 'github', callbackURL: redirect })}
        className="press mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background"
      >
        <GithubIcon className="size-4" weight="fill" />
        {t('auth.withGithub')}
      </button>

      <LocaleLink
        to="/"
        className="mt-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <HomeIcon className="size-3.5" />
        {t('notFound.home')}
      </LocaleLink>
    </div>
  )
}
