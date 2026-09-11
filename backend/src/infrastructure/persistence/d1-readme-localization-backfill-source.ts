import { and, asc, eq, gt } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import type { ReadmeLocalizationBackfillSource } from '../../application/port/readme-localization.js'
import type { Slug } from '../../domain/shared/slug.js'
import { slug } from '../../domain/shared/slug.js'
import { artifacts } from './catalog-schema.js'
import * as schema from './schema.js'

type Db = DrizzleD1Database<typeof schema> & { readonly $client: D1Database }
interface RetryRow {
  readonly artifact_id: string
  readonly markdown: string | null
  readonly summary: string
}

const STALE_FAILURES_SQL = `
  with failed_candidates as (
    select artifact_id, min(updated_at) as oldest_failure
    from artifact_readme_translations
    where status = 'failed'
      and updated_at < ?1
      and locale in (select value from json_each(?3))
    group by artifact_id
    union all
    select artifact_id, min(updated_at) as oldest_failure
    from artifact_summary_translations
    where status = 'failed'
      and updated_at < ?1
      and locale in (select value from json_each(?3))
    group by artifact_id
  ),
  missing_summaries as (
    select artifact.id as artifact_id, 0 as oldest_failure
    from artifacts as artifact
    where artifact.deprecated = 0
      and exists (
        select 1 from json_each(?3) as required_locale
        where not exists (
          select 1
          from artifact_summary_translations as summary
          where summary.artifact_id = artifact.id
            and summary.locale = required_locale.value
        )
      )
  ),
  candidates as (
    select artifact_id, min(oldest_failure) as oldest_failure
    from (
      select artifact_id, oldest_failure from failed_candidates
      union all
      select artifact_id, oldest_failure from missing_summaries
    )
    group by artifact_id
  )
  select
    artifact.id as artifact_id,
    artifact.readme_markdown as markdown,
    artifact.summary
  from candidates
  inner join artifacts as artifact on artifact.id = candidates.artifact_id
  where artifact.deprecated = 0
  order by candidates.oldest_failure, artifact.id
  limit ?2
`

/** Lightweight D1 projection; it never hydrates full Artifact aggregates. */
export class D1ReadmeLocalizationBackfillSource implements ReadmeLocalizationBackfillSource {
  constructor(
    private readonly db: Db,
    private readonly locales: readonly string[],
  ) {
    if (locales.length === 0) throw new Error('README localization needs target locales.')
  }

  async listAfter(afterArtifactId: Slug | undefined, limit: number) {
    const rows = await this.db
      .select({
        artifactId: artifacts.id,
        markdown: artifacts.readmeMarkdown,
        summary: artifacts.summary,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.deprecated, false),
          ...(afterArtifactId === undefined ? [] : [gt(artifacts.id, afterArtifactId)]),
        ),
      )
      .orderBy(asc(artifacts.id))
      .limit(limit)

    return rows.map(readmeRow)
  }

  async listStaleFailures(olderThan: Date, limit: number) {
    // Start from the narrow translation indexes and aggregate once. The old
    // correlated EXISTS query repeatedly scanned ~50k failed rows for every
    // artifact and accounted for billions of production rows-read per day.
    const statement = this.db.$client.prepare(STALE_FAILURES_SQL)
    const result = await statement
      .bind(olderThan.getTime(), limit, JSON.stringify(this.locales))
      .all<RetryRow>()
    return result.results.map((row) =>
      readmeRow({ artifactId: row.artifact_id, markdown: row.markdown, summary: row.summary }),
    )
  }
}

function readmeRow(row: { artifactId: string; markdown: string | null; summary: string }) {
  return {
    artifactId: slug(row.artifactId),
    ...(row.markdown === null || row.markdown.trim() === '' ? {} : { markdown: row.markdown }),
    summary: row.summary,
  }
}
