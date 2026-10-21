import { toTranslation } from './summary-translation-row.js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type {
  SummaryTranslation,
  SummaryTranslationRepository,
} from '../../domain/artifact/summary-translation.js'
import type { Slug } from '../../domain/shared/slug.js'
import { artifactSummaryTranslations } from './mysql-schema.js'
import * as schema from './mysql-schema.js'

type Db = MySql2Database<typeof schema>

export class MysqlSummaryTranslationRepository implements SummaryTranslationRepository {
  constructor(private readonly db: Db) {}

  async find(artifactId: Slug, locale: string): Promise<SummaryTranslation | undefined> {
    const rows = await this.db
      .select()
      .from(artifactSummaryTranslations)
      .where(
        and(
          eq(artifactSummaryTranslations.artifactId, artifactId),
          eq(artifactSummaryTranslations.locale, locale),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? undefined : toTranslation(row)
  }

  async listFor(artifactIds: readonly Slug[], locale: string): Promise<readonly SummaryTranslation[]> {
    if (artifactIds.length === 0) return []
    const rows = await this.db
      .select()
      .from(artifactSummaryTranslations)
      .where(
        and(
          inArray(artifactSummaryTranslations.artifactId, artifactIds.map(String)),
          eq(artifactSummaryTranslations.locale, locale),
        ),
      )
    return rows.map(toTranslation)
  }

  async save(
    translation: SummaryTranslation,
    options: { readonly retainPreviousBody?: boolean } = {},
  ): Promise<void> {
    const values = {
      artifactId: String(translation.artifactId),
      locale: translation.locale,
      sourceHash: translation.sourceHash,
      status: translation.status,
      text: translation.text ?? null,
      error: translation.error ?? null,
      updatedAt: translation.updatedAt,
    }
    await this.db
      .insert(artifactSummaryTranslations)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          ...values,
          text:
            options.retainPreviousBody === false
              ? values.text
              : sql`coalesce(values(text), ${artifactSummaryTranslations.text})`,
        },
      })
  }
}
