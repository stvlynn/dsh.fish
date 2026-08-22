import { productDocsMarkdown, productDocsPaths } from '@/pages/docs'
import { docsLlmsFull, llmsTxtResponse } from './llms'

/**
 * `/docs/llms-full.txt` — every English product guide concatenated.
 *
 * A community convention (Mintlify, GitBook, Cloudflare docs), not part of
 * the llms.txt spec. The plugin catalog is not dumped: that is the snapshot.
 */
export function loader() {
  const pages = productDocsPaths().map((path) => {
    const markdown = productDocsMarkdown(path)
    if (markdown === undefined) {
      throw new Error(`Product docs source has no markdown for ${path}`)
    }
    return { path, markdown }
  })
  return llmsTxtResponse(docsLlmsFull(pages))
}
