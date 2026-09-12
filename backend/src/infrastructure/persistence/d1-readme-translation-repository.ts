import { and, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type {
  ReadmeTranslation,
  ReadmeTranslationRepository,
  ReadmeTranslationStatus,
} from '../../domain/artifact/readme-translation.js'
import type { Slug } from '../../domain/shared/slug.js'
import { slug } from '../../domain/shared/slug.js'
import { artifactReadmeTranslations } from './catalog-schema.js'
import * as schema from './schema.js'

type Db = DrizzleD1Database<typeof schema>
type TranslationRow = typeof artifactReadmeTranslations.$inferSelect

export class D1ReadmeTranslationRepository implements ReadmeTranslationRepository {
  constructor(private readonly db: Db) {}

  async find(artifactId: Slug, locale: string): Promise<ReadmeTranslation | undefined> {
    const rows = await this.db
      .select()
      .from(artifactReadmeTranslations)
      .where(
        and(
          eq(artifactReadmeTranslations.artifactId, artifactId),
          eq(artifactReadmeTranslations.locale, locale),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? undefined : toTranslation(row)
  }

  async save(
    translation: ReadmeTranslation,
    options: { readonly retainPreviousBody?: boolean } = {},
  ): Promise<void> {
    const values = {
      artifactId: String(translation.artifactId),
      locale: translation.locale,
      sourceHash: translation.sourceHash,
      status: translation.status,
      markdown: translation.markdown ?? null,
      error: translation.error ?? null,
      updatedAt: translation.updatedAt,
    }
    await this.db
      .insert(artifactReadmeTranslations)
      .values(values)
      .onConflictDoUpdate({
        target: [artifactReadmeTranslations.artifactId, artifactReadmeTranslations.locale],
        set: {
          ...values,
          markdown:
            options.retainPreviousBody === false
              ? values.markdown
              : sql`coalesce(excluded.markdown, ${artifactReadmeTranslations.markdown})`,
        },
      })
  }
}

function toTranslation(row: TranslationRow): ReadmeTranslation {
  return {
    artifactId: slug(row.artifactId),
    locale: row.locale,
    sourceHash: row.sourceHash,
    status: translationStatus(row.status),
    ...(row.markdown === null ? {} : { markdown: row.markdown }),
    ...(row.error === null ? {} : { error: row.error }),
    updatedAt: row.updatedAt,
  }
}

function translationStatus(value: string): ReadmeTranslationStatus {
  if (value === 'pending' || value === 'completed' || value === 'failed') return value
  throw new Error(`Unknown README translation status: ${value}`)
}
