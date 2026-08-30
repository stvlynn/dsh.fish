import type { Route } from './+types/blog-page'
import browserCollections from 'collections/browser'
import { hubContext } from '@/shared/api/hub-context'
import {
  localeDefinition,
  requireLocale,
  translate,
  type Locale,
} from '@/shared/config/i18n'
import {
  blogPostingLd,
  breadcrumbLd,
  collectionLd,
  errorMeta,
  pageMeta,
} from '@/shared/lib/seo'
import { BlogPostList, BlogShell } from '@/widgets/blog-shell'
import { blogMdxComponents } from './mdx'
import { blogLocales } from './raw'
import {
  BLOG_SERIES,
  isBlogSeries,
  seriesDescriptionKey,
  seriesTitleKey,
} from './series'
import {
  listBlogPosts,
  postDateIso,
  readBlogPage,
  slugsFromSplat,
  source,
  tocFromCompiled,
  type BlogPostSummary,
} from './source'

const blogContent = browserCollections.blog.createClientLoader({
  component: ({ default: Mdx }) => <Mdx components={blogMdxComponents()} />,
})

function seriesNav(locale: Locale) {
  return [
    { id: 'all', href: '/blog', title: translate(locale, 'blog.allPosts') },
    ...BLOG_SERIES.map((series) => ({
      id: series,
      href: `/blog/${series}`,
      title: translate(locale, seriesTitleKey(series)),
    })),
  ]
}

function cardsFor(locale: Locale, posts: readonly BlogPostSummary[]) {
  return posts.map((post) => ({
    url: post.url,
    title: post.title,
    description: post.description,
    date: post.date,
    seriesId: post.series,
    seriesTitle: translate(locale, seriesTitleKey(post.series)),
    cover: post.cover,
  }))
}

function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeDefinition(locale).tag, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

export function meta({
  loaderData,
  params,
}: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData) return errorMeta(params.locale)
  const {
    origin,
    locale,
    path,
    title,
    description,
    availableLocales,
    jsonLd,
    type,
  } = loaderData
  return pageMeta({
    origin,
    locale,
    path,
    title: `${title} — ${translate(locale, 'app.name')}`,
    description,
    index: availableLocales.includes(locale),
    availableLocales,
    type,
    jsonLd,
  })
}

export function loader({ context, params }: Route.LoaderArgs) {
  const locale = requireLocale(params.locale)
  const slugs = slugsFromSplat(params['*'])
  const origin = context.get(hubContext).container.config.baseUrl
  const nav = seriesNav(locale)

  if (slugs.length === 0) {
    const posts = listBlogPosts(locale)
    const title = translate(locale, 'blog.title')
    const description = translate(locale, 'seo.blog.description')
    const path = '/blog'
    return {
      kind: 'listing' as const,
      locale,
      origin,
      path,
      title,
      description,
      availableLocales: blogLocales(path),
      currentSeries: undefined,
      nav,
      posts: cardsFor(locale, posts),
      type: 'website' as const,
      jsonLd: [
        breadcrumbLd(origin, locale, [
          { name: translate(locale, 'app.name'), path: '/' },
          { name: title, path },
        ]),
        collectionLd(origin, locale, {
          path,
          name: title,
          description,
          items: posts.map((post) => ({ name: post.title, path: post.url })),
        }),
      ],
    }
  }

  if (slugs.length === 1 && isBlogSeries(slugs[0]!)) {
    const series = slugs[0]
    const posts = listBlogPosts(locale, series)
    const title = translate(locale, seriesTitleKey(series))
    const description = translate(locale, seriesDescriptionKey(series))
    const path = `/blog/${series}`
    return {
      kind: 'listing' as const,
      locale,
      origin,
      path,
      title,
      description,
      availableLocales: blogLocales(path),
      currentSeries: series,
      nav,
      posts: cardsFor(locale, posts),
      type: 'website' as const,
      jsonLd: [
        breadcrumbLd(origin, locale, [
          { name: translate(locale, 'app.name'), path: '/' },
          { name: translate(locale, 'blog.title'), path: '/blog' },
          { name: title, path },
        ]),
        collectionLd(origin, locale, {
          path,
          name: title,
          description,
          items: posts.map((post) => ({ name: post.title, path: post.url })),
        }),
      ],
    }
  }

  const page = source.getPage(slugs, locale)
  if (!page) throw new Response(null, { status: 404, statusText: 'Not Found' })

  const data = readBlogPage(page)
  const date = postDateIso(data.date)
  const availableLocales = blogLocales(page.url)

  return {
    kind: 'post' as const,
    locale,
    origin,
    path: page.url,
    contentPath: page.path,
    title: data.title,
    description: data.description,
    author: data.author,
    writtenBy: translate(locale, 'blog.writtenBy'),
    date,
    series: data.series,
    cover: data.cover,
    seriesTitle: translate(locale, seriesTitleKey(data.series)),
    formattedDate: formatDate(date, locale),
    availableLocales,
    currentSeries: data.series,
    nav,
    toc: tocFromCompiled(data),
    type: 'article' as const,
    jsonLd: [
      breadcrumbLd(origin, locale, [
        { name: translate(locale, 'app.name'), path: '/' },
        { name: translate(locale, 'blog.title'), path: '/blog' },
        {
          name: translate(locale, seriesTitleKey(data.series)),
          path: `/blog/${data.series}`,
        },
        { name: data.title, path: page.url },
      ]),
      blogPostingLd(origin, locale, {
        path: page.url,
        title: data.title,
        description: data.description,
        datePublished: date,
        author: data.author,
      }),
    ],
  }
}

export default function BlogPage({ loaderData }: Route.ComponentProps) {
  if (loaderData.kind === 'listing') {
    const { nav, currentSeries, title, description, posts } = loaderData
    return (
      <BlogShell seriesNav={nav} currentSeries={currentSeries}>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        <p className="mt-3 text-pretty text-muted-foreground">{description}</p>
        <div className="mt-8">
          <BlogPostList posts={posts} />
        </div>
      </BlogShell>
    )
  }

  const {
    contentPath,
    title,
    description,
    author,
    writtenBy,
    formattedDate,
    date,
    seriesTitle,
    cover,
    nav,
    currentSeries,
    toc,
  } = loaderData

  return (
    <BlogShell seriesNav={nav} currentSeries={currentSeries} toc={toc}>
      <header>
        <div className="max-w-3xl">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {seriesTitle}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
            {title}
          </h1>
          <p className="mt-3 text-pretty text-muted-foreground">
            {description}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            <time dateTime={date}>{formattedDate}</time>
            <span aria-hidden="true"> · </span>
            {writtenBy} {author}
          </p>
        </div>
        <img
          src={cover}
          alt=""
          width={1600}
          height={900}
          fetchPriority="high"
          className="mt-8 aspect-video w-full rounded-xl border border-border bg-muted object-cover"
        />
      </header>
      <div className="mt-8">{blogContent.useContent(contentPath)}</div>
    </BlogShell>
  )
}
