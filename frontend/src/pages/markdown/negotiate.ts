/**
 * Content negotiation for agents.
 *
 * An agent asks for markdown with `Accept: text/markdown`; a browser never
 * sends that type, so HTML stays the default. The q-value rules are the
 * HTTP ones: an explicit `q=0` refuses the type, and a type that is more
 * acceptable than `text/html` wins.
 */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  if (acceptHeader === null) return false

  let markdownQ: number | undefined
  let htmlQ: number | undefined
  let anyQ: number | undefined

  for (const part of acceptHeader.split(',')) {
    const [rawType, ...params] = part.trim().split(';')
    const type = rawType?.trim().toLowerCase()
    if (type === undefined || type === '') continue
    const qParam = params
      .map((param) => param.trim())
      .find((param) => param.startsWith('q='))
    const q = qParam === undefined ? 1 : Number(qParam.slice(2))
    if (Number.isNaN(q)) continue

    if (type === 'text/markdown' || type === 'text/x-markdown') markdownQ = q
    else if (type === 'text/html') htmlQ = q
    else if (type === '*/*') anyQ = q
  }

  if (markdownQ === undefined || markdownQ === 0) return false
  // An explicit text/html with a higher q wins; a wildcard does not — an agent
  // that names text/markdown at all is asking for it.
  if (htmlQ !== undefined && htmlQ > markdownQ) return false
  void anyQ
  return true
}

/**
 * Whether a 404 should be served as markdown rather than the HTML error page.
 *
 * Browsers send `text/html` and keep the HTML 404. curl's default Accept
 * wildcard (and an empty Accept) get a short markdown recovery map, which is
 * what agent auditors fetch when they probe a missing path.
 */
export function wantsMarkdownNotFound(acceptHeader: string | null): boolean {
  if (prefersMarkdown(acceptHeader)) return true
  if (acceptHeader !== null && /application\/json/i.test(acceptHeader)) return false
  if (acceptHeader !== null && /text\/html/i.test(acceptHeader)) return false
  const trimmed = acceptHeader?.trim() ?? ''
  return trimmed === '' || trimmed === '*/*' || trimmed.toLowerCase().startsWith('*/*')
}

/** Rough token estimate, matching the four-characters-per-token convention. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
