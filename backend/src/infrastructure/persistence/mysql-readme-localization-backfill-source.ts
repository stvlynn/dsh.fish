import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type { RowDataPacket } from 'mysql2'
import type { ReadmeLocalizationBackfillSource } from '../../application/port/readme-localization.js'
import type { Slug } from '../../domain/shared/slug.js'
import { slug } from '../../domain/shared/slug.js'
import { artifacts } from './mysql-schema.js'
import * as schema from './mysql-schema.js'

export class MysqlReadmeLocalizationBackfillSource implements ReadmeLocalizationBackfillSource {
  constructor(
    private readonly db: MySql2Database<typeof schema>,
    private readonly locales: readonly string[],
  ) {
    if (!locales.length) throw new Error('README localization needs target locales.')
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
    return rows.map(toInput)
  }

  async listStaleFailures(olderThan: Date, limit: number) {
    const locales = JSON.stringify(this.locales)
    const [result] = await this.db.execute(sql`
      with required_locales as (
        select locale from json_table(${locales}, '$[*]' columns(locale varchar(32) path '$')) as required
      ), failed_candidates as (
        select artifact_id, min(updated_at) as oldest_failure from artifact_readme_translations
        where status='failed' and updated_at < ${olderThan.getTime()} and locale in (select locale from required_locales)
        group by artifact_id
        union all
        select artifact_id, min(updated_at) as oldest_failure from artifact_summary_translations
        where status='failed' and updated_at < ${olderThan.getTime()} and locale in (select locale from required_locales)
        group by artifact_id
      ), candidates as (
        select artifact_id, min(oldest_failure) as oldest_failure from (
          select artifact_id, oldest_failure from failed_candidates
          union all
          select a.id, 0 from artifacts a where a.deprecated=0 and exists (
            select 1 from required_locales r where not exists (
              select 1 from artifact_summary_translations s where s.artifact_id=a.id and s.locale=r.locale
            )
          )
        ) combined group by artifact_id
      )
      select a.id as artifactId, a.readme_markdown as markdown, a.summary
      from candidates c join artifacts a on a.id=c.artifact_id
      where a.deprecated=0 order by c.oldest_failure,a.id limit ${limit}`)
    if (!Array.isArray(result)) throw new Error('Expected backfill query rows.')
    const rows = result as RowDataPacket[]
    return rows.map((row) =>
      toInput({
        artifactId: String(row.artifactId),
        markdown: row.markdown === null ? null : String(row.markdown),
        summary: String(row.summary),
      }),
    )
  }
}

function toInput(row: { artifactId: string; markdown: string | null; summary: string }) {
  return {
    artifactId: slug(row.artifactId),
    summary: row.summary,
    ...(row.markdown === null || row.markdown.trim() === '' ? {} : { markdown: row.markdown }),
  }
}
