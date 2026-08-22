import type { Route } from './+types/docs-llms-txt'
import { hubContext } from '@/shared/api/hub-context'
import { DEFAULT_LOCALE, translate } from '@/shared/config/i18n'
import { markdownPath } from '@/shared/lib/seo'
import { docsNav, docsSitemapPaths } from '@/pages/docs/source'
import { docsLlmsTxt, llmsTxtResponse } from './llms'

/**
 * `/docs/llms.txt` — the product-docs overview for agents (llmstxt.org v2).
 *
 * File lists are generated from the Fumadocs nav so a guide added to the MDX
 * tree appears here in the same commit. A missing slug is a loader error, not a
 * silently incomplete map.
 */
export function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(hubContext).container.config
  const nav = docsNav(DEFAULT_LOCALE).map((node) =>
    node.type === 'separator'
      ? { type: 'separator' as const, title: translate(DEFAULT_LOCALE, node.titleKey) }
      : { type: 'page' as const, title: node.title, url: node.url },
  )
  const body = docsLlmsTxt(baseUrl, nav)
  const missing = docsSitemapPaths().filter((path) => !body.includes(`${baseUrl.replace(/\/+$/, '')}${markdownPath(path)}`))
  if (missing.length > 0) {
    throw new Error(`docs llms.txt is missing ${missing.join(', ')}`)
  }
  return llmsTxtResponse(body)
}
