/**
 * Public API of the product-docs page slice for other pages.
 *
 * Markdown negotiation needs the bundled source text, which does not import
 * Fumadocs. The sitemap and `/docs/llms.txt` read `docsSitemapEntries` /
 * `docsNav` from `./source` directly because those lists are generated from
 * the MDX tree — see architecture.md.
 */
export { productDocsMarkdown, productDocsPaths, supportsProductDocsMarkdown } from './raw'
