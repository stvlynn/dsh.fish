import { sqlString } from './sql.ts'

/** Matches `DEFAULT_PAGE_SIZE` / the browse loader. */
export const CATALOG_PAGE_SIZE = 24

/**
 * Extra public rows so `/browse` actually has a second page. The shared seed
 * stays one artifact per kind; these exist only in the e2e D1.
 *
 * `installs = n` gives each filler a distinct `listRank` of `3n`, all below
 * the real seeded plugins, so page two is always the two lowest fillers.
 */
export const PAGINATION_FILLER_COUNT = 20

export function paginationFillerId(n: number): string {
  return `e2e-page-${String(n).padStart(2, '0')}`
}

export function paginationFillerSql(): string {
  const artifacts = Array.from({ length: PAGINATION_FILLER_COUNT }, (_, index) => {
    const n = index + 1
    const id = paginationFillerId(n)
    return `(
  ${sqlString(id)}, 'bundle', ${sqlString(id)},
  ${sqlString(`Pagination filler ${String(n).padStart(2, '0')}.`)},
  ${sqlString(`{"origin":"npm","packageName":"${id}","latestVersion":"0.0.1"}`)}, 'npm',
  '{"kind":"bundle","requiresBuild":false}',
  '["e2e"]', '["other"]', 'MIT', 'e2e', 0,
  0, 0, ${n},
  1754006400000, 1754006400000, 1754006400000
)`
  })

  const categories = Array.from({ length: PAGINATION_FILLER_COUNT }, (_, index) => {
    const id = paginationFillerId(index + 1)
    return `(${sqlString(id)}, 'other')`
  })

  return `
INSERT INTO artifacts (
  id, kind, display_name, summary, source, source_origin, payload,
  keywords, categories, license, author_name, deprecated,
  stars, downloads, installs,
  published_at, updated_at, indexed_at
) VALUES
${artifacts.join(',\n')};

INSERT INTO artifact_search (artifact_id, haystack)
SELECT id, lower(display_name || ' ' || summary) FROM artifacts
WHERE id LIKE 'e2e-page-%';

INSERT INTO artifact_search_documents (
  artifact_id, locale, display_name, summary, keywords, topics, summary_hash
)
SELECT
  id,
  'und',
  lower(display_name),
  lower(summary),
  'e2e',
  '',
  'seed'
FROM artifacts
WHERE id LIKE 'e2e-page-%';

INSERT INTO artifact_categories (artifact_id, category_id) VALUES
${categories.join(',\n')};

UPDATE artifacts SET popularity = (installs * 3 + stars + downloads / 10.0)
  * (CASE WHEN owner_account_id IS NOT NULL THEN 1.25 ELSE 1 END)
  * (CASE WHEN deprecated THEN 0.1 ELSE 1 END);
`
}
