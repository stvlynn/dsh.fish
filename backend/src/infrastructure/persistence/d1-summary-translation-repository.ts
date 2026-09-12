import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type {
  SummaryTranslation,
  SummaryTranslationRepository,
  SummaryTranslationStatus,
} from '../../domain/artifact/summary-translation.js'
import type { Slug } from '../../domain/shared/slug.js'
import { slug } from '../../domain/shared/slug.js'
import { artifactSummaryTranslations } from './catalog-schema.js'
import * as schema from './schema.js'

type Db = DrizzleD1Database<typeof schema>
type TranslationRow = typeof artifactSummaryTranslations.$inferSelect

export class D1SummaryTranslationRepository implements SummaryTranslationRepository {
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
      .onConflictDoUpdate({
        target: [artifactSummaryTranslations.artifactId, artifactSummaryTranslations.locale],
        set: {
          ...values,
          text:
            options.retainPreviousBody === false
              ? values.text
              : sql`coalesce(excluded.text, ${artifactSummaryTranslations.text})`,
        },
      })
  }
}

function toTranslation(row: TranslationRow): SummaryTranslation {
  return {
    artifactId: slug(row.artifactId),
    locale: row.locale,
    sourceHash: row.sourceHash,
    status: translationStatus(row.status),
    ...(row.text === null ? {} : { text: row.text }),
    ...(row.error === null ? {} : { error: row.error }),
    updatedAt: row.updatedAt,
  }
}

function translationStatus(value: string): SummaryTranslationStatus {
  if (value === 'pending' || value === 'completed' || value === 'failed') return value
  throw new Error(`Unknown summary translation status: ${value}`)
}
