import {
  ARTIFACT_KINDS,
  CATEGORIES,
  TOPICS,
  kindDescriptionKey,
  kindPluralKey,
} from '@/entities/artifact/model/types'
import { DEFAULT_LOCALE, translate } from '@/shared/config/i18n'
import { HARNESS_REPO_URL } from '@/shared/config/site'
import { markdownPath } from '@/shared/lib/seo'

/**
 * llms.txt serializers (https://llmstxt.org/ v2).
 *
 * Markdown overviews for agents, not sitemaps and not robots.txt. The root
 * file is curated: it points at the API, the kind landings, and `/docs/llms.txt`
 * rather than enumerating the catalog. File lists follow the spec shape
 * `- [name](url): notes`. Prose is English on purpose — agents fetch `/llms.txt`
 * at the origin, the same way they fetch `/robots.txt`.
 */

export interface LlmsNavNode {
  readonly type: 'separator' | 'page'
  readonly title: string
  readonly url?: string
}

export interface LlmsFullPage {
  readonly path: string
  readonly markdown: string
}

const CACHE_CONTROL = 'public, max-age=86400'

export function llmsTxtResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': CACHE_CONTROL,
    },
  })
}

function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function href(baseUrl: string, path: string): string {
  return `${origin(baseUrl)}${path}`
}

function item(name: string, url: string, notes?: string): string {
  return notes === undefined || notes === '' ? `- [${name}](${url})` : `- [${name}](${url}): ${notes}`
}

function md(baseUrl: string, path: string): string {
  return href(baseUrl, markdownPath(path))
}

/**
 * `/llms.txt` — covers the origin. Catalog rows are not listed; agents search
 * the JSON API or read the snapshot.
 */
export function rootLlmsTxt(baseUrl: string): string {
  const locale = DEFAULT_LOCALE
  const name = translate(locale, 'app.name')

  return [
    `# ${name}`,
    `> ${translate(locale, 'app.tagline')}. ${translate(locale, 'app.description')}`,
    '',
    'This file is a curated map for agents, not a catalog dump. Search and list plugins through the JSON API or the versioned snapshot; do not expect every plugin URL here.',
    '',
    'Content pages have a markdown representation: append `.md` to the path (`/docs/cli.md`, `/a/{id}.md`, `/index.md` for the home page) or send `Accept: text/markdown` on the HTML URL. English is unprefixed; other languages use a path prefix (`/ja`, `/zh-CN`, `/zh-TW`, `/ko`, `/ru`). Inference and search use is welcome; training crawlers are denied.',
    '',
    '## Start here',
    item(name, md(baseUrl, '/'), 'The hub home page.'),
    item('Browse the catalog', md(baseUrl, '/browse'), 'Full listing; page through the API for more than the first fifty rows.'),
    item('Product docs', href(baseUrl, '/docs/llms.txt'), 'Guides for the CLI, publishing, scoring, and the REST API.'),
    item('Submit a plugin', href(baseUrl, '/submit'), 'How a repository becomes a catalog row.'),
    '',
    '## Catalog',
    ...ARTIFACT_KINDS.map((kind) =>
      item(
        translate(locale, kindPluralKey(kind)),
        md(baseUrl, `/kind/${kind}`),
        translate(locale, kindDescriptionKey(kind)),
      ),
    ),
    '',
    '## API',
    item('OpenAPI', href(baseUrl, '/openapi.json'), 'Machine-readable description of the anonymous JSON API.'),
    item('Search', href(baseUrl, '/api/v1/artifacts'), 'Filter and page the catalog. Agents should page here rather than scraping HTML.'),
    item('Artifact detail', href(baseUrl, '/api/v1/artifacts/{id}'), 'One plugin: metadata, README, install plan.'),
    item('Catalog snapshot', href(baseUrl, '/api/v1/catalog/snapshot'), 'The whole public catalog as one JSON document, with ETag/304.'),
    item('Scoring model', href(baseUrl, '/api/v1/scoring'), 'The public quality-score formula the site executes.'),
    item('API catalog', href(baseUrl, '/.well-known/api-catalog'), 'RFC 9727 linkset of the machine-readable doors.'),
    '',
    '## Optional',
    item('Product docs (full)', href(baseUrl, '/docs/llms-full.txt'), 'Every English guide concatenated. Prefer /docs/llms.txt unless the whole set is needed.'),
    ...CATEGORIES.map((category) =>
      item(translate(locale, category.labelKey), md(baseUrl, `/category/${category.id}`)),
    ),
    ...TOPICS.map((topic) =>
      item(translate(locale, topic.labelKey), href(baseUrl, `/for/${topic.id}`), 'Curated intent page.'),
    ),
    item('Atom feed', href(baseUrl, '/feed.xml'), 'The fifty most recently updated artifacts. Other languages at /<locale>/feed.xml.'),
    item('Sitemap', href(baseUrl, '/sitemap.xml'), 'Complete URL inventory for search engines, every language of every page.'),
    item('DeepSeek Harness', HARNESS_REPO_URL, 'The runtime this registry exists for.'),
    '',
  ].join('\n')
}

/**
 * `/docs/llms.txt` — covers `/docs/*`. `nav` is the English product-docs tree
 * so a guide added to the MDX source appears here in the same commit.
 */
export function docsLlmsTxt(baseUrl: string, nav: readonly LlmsNavNode[]): string {
  const sections: { heading: string; entries: string[] }[] = []
  let current: { heading: string; entries: string[] } = { heading: 'Docs', entries: [] }

  for (const node of nav) {
    if (node.type === 'separator') {
      if (current.entries.length > 0) sections.push(current)
      current = { heading: node.title, entries: [] }
      continue
    }
    if (node.url === undefined) continue
    current.entries.push(item(node.title, md(baseUrl, node.url)))
  }
  if (current.entries.length > 0) sections.push(current)

  return [
    `# ${translate(DEFAULT_LOCALE, 'app.name')} documentation`,
    '> Guides for using the hub, the CLI, and publishing every artifact kind DeepSeek Harness loads.',
    '',
    'This file covers `/docs/*`. The site-wide map is `/llms.txt`. Each guide is also at the same path with `.md` appended (`/docs/cli.md`). A concatenation of every English guide is `/docs/llms-full.txt`. Other languages use a path prefix (`/ja/docs/cli.md`).',
    '',
    ...sections.flatMap((section) => [`## ${section.heading}`, ...section.entries, '']),
  ].join('\n')
}

/**
 * `/docs/llms-full.txt` — community convention, not in the spec. English
 * product docs only; the plugin catalog is not dumped.
 */
export function docsLlmsFull(pages: readonly LlmsFullPage[]): string {
  const header = [
    `# ${translate(DEFAULT_LOCALE, 'app.name')} documentation`,
    '',
    'English product guides, concatenated. The curated index is `/docs/llms.txt`.',
    '',
  ].join('\n')

  return [header, ...pages.map((page) => page.markdown.trim())].join('\n---\n\n')
}
