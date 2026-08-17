import { data, Link } from 'react-router'
import { BadgeCheck, ExternalLink, Scale } from 'lucide-react'
import type { Route } from './+types/artifact-detail-page'
import { hubContext } from '@/shared/api/hub-context'
import { InstallPanel } from '@/widgets/install-panel/install-panel'
import { KindChip } from '@/entities/artifact/ui/kind-chip'
import { Markdown } from '@/shared/ui/markdown'
import { t } from '@/shared/config/messages'
import { compactNumber, relativeTime } from '@/shared/lib/format'

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  // A 404 renders the error boundary, so loaderData is absent there.
  if (!loaderData) return [{ title: t('notFound.title') }]
  const { artifact } = loaderData
  return [
    { title: `${artifact.displayName} — ${t('app.name')}` },
    { name: 'description', content: artifact.summary },
    // A directory lives on link previews; these are what a shared plugin URL
    // renders as in chat and on social.
    { property: 'og:title', content: artifact.displayName },
    { property: 'og:description', content: artifact.summary },
    { property: 'og:type', content: 'website' },
  ]
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { container } = context.get(hubContext)
  const profile = new URL(request.url).searchParams.get('profile') ?? undefined

  const artifact = await container.useCases.getArtifactDetail
    .execute(params.artifactId)
    .catch(() => undefined)

  if (!artifact) {
    throw data({ message: t('notFound.body') }, { status: 404 })
  }

  // Previewing a plan is not installing: `recordInstall` stays off here, so the
  // install counter never becomes a page-view counter.
  const plan = await container.useCases.resolveInstallPlan.execute({
    artifactId: artifact.id,
    ...(profile === undefined ? {} : { profile }),
  })

  return { artifact, plan, now: Date.now() }
}

export default function ArtifactDetailPage({ loaderData }: Route.ComponentProps) {
  const { artifact, plan, now } = loaderData

  return (
    <article className="mx-auto max-w-6xl px-6 py-10">
      <header className="border-b border-border pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <KindChip kind={artifact.kind} />
          {artifact.verified ? (
            <span
              title={t('artifact.verifiedTitle')}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              <BadgeCheck className="size-3.5" aria-hidden />
              {t('artifact.verified')}
            </span>
          ) : null}
          {artifact.deprecated ? (
            <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
              {t('artifact.deprecated')}
            </span>
          ) : null}
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{artifact.displayName}</h1>
        <p className="mt-2 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {artifact.summary}
        </p>

        <dl className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {artifact.author ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{t('artifact.source')}</dt>
              <dd className="font-medium text-foreground">{artifact.author.name}</dd>
            </div>
          ) : null}
          {artifact.stats.installs > 0 ? (
            <Metric label={t('artifact.installs')} value={artifact.stats.installs} />
          ) : null}
          {artifact.stats.stars > 0 ? (
            <Metric label={t('artifact.stars')} value={artifact.stats.stars} />
          ) : null}
          {artifact.stats.downloads > 0 ? (
            <Metric label={t('artifact.downloads')} value={artifact.stats.downloads} />
          ) : null}
          {artifact.license ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{t('artifact.license')}</dt>
              <dd className="inline-flex items-center gap-1">
                <Scale className="size-3.5" aria-hidden />
                {artifact.license}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="sr-only">{t('artifact.updated')}</dt>
            <dd>
              {t('artifact.updated')} {relativeTime(artifact.updatedAt, now)}
            </dd>
          </div>
        </dl>

        {artifact.keywords.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {artifact.keywords.slice(0, 12).map((keyword) => (
              <li key={keyword}>
                <Link
                  to={`/browse?q=${encodeURIComponent(keyword)}`}
                  className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                >
                  {keyword}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_22rem]">
        {/* `min-w-0`: a grid item's automatic minimum size is its min-content
            width, so without this the column widens to fit the readme's widest
            table row or code line and takes the whole page sideways with it —
            the `overflow-x-auto` on those blocks never gets to engage. */}
        <section className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            {t('artifact.readme')}
          </h2>
          {artifact.readmeMarkdown ? (
            // The bases are what a relative path inside the readme resolves
            // against — the readme was written against its own repository, not
            // against this page. See `Markdown` for why rendering a crawled
            // readme is safe.
            <Markdown
              source={artifact.readmeMarkdown}
              docBase={artifact.sourceDocBase}
              assetBase={artifact.sourceAssetBase}
              className="mt-5"
            />
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{t('artifact.noReadme')}</p>
          )}
        </section>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
          <InstallPanel artifact={artifact} plan={plan} />

          <a
            href={artifact.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="press flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4 text-sm font-medium hover:border-border-strong"
          >
            {t('artifact.source')}
            <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
          </a>
        </div>
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="font-medium tabular-nums text-foreground">{compactNumber(value)}</span>{' '}
        {label}
      </dd>
    </div>
  )
}
