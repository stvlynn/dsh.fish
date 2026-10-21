import { toTranslation } from './readme-translation-row.js'
import { and, eq, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type {
  ReadmeTranslation,
  ReadmeTranslationRepository,
} from '../../domain/artifact/readme-translation.js'
import type { Slug } from '../../domain/shared/slug.js'
import { artifactReadmeTranslations } from './mysql-schema.js'
import * as schema from './mysql-schema.js'

type Db = MySql2Database<typeof schema>

export class MysqlReadmeTranslationRepository implements ReadmeTranslationRepository {
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
      .onDuplicateKeyUpdate({
        set: {
          ...values,
          markdown:
            options.retainPreviousBody === false
              ? values.markdown
              : sql`coalesce(values(markdown), ${artifactReadmeTranslations.markdown})`,
        },
      })
  }
}
