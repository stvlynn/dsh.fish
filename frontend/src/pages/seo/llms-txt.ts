import type { Route } from './+types/llms-txt'
import { hubContext } from '@/shared/api/hub-context'
import { llmsTxtResponse, rootLlmsTxt } from './llms'

/**
 * `/llms.txt` — the origin-level overview for agents (llmstxt.org v2).
 *
 * Curated on purpose: the catalog lives in the JSON API and the sitemap, and
 * dumping it here would blow the context window the file exists to spare.
 */
export function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(hubContext).container.config
  return llmsTxtResponse(rootLlmsTxt(baseUrl))
}
