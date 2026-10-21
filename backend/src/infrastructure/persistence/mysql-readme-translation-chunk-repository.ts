import { and, asc, eq, ne } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type { Slug } from '../../domain/shared/slug.js'
import { artifactReadmeTranslationChunks } from './mysql-schema.js'
import * as schema from './mysql-schema.js'

type Db = MySql2Database<typeof schema>

export class MysqlReadmeTranslationChunkRepository {
  constructor(private readonly db: Db) {}

  async prepare(
    artifactId: Slug,
    locale: string,
    sourceHash: string,
  ): Promise<ReadonlySet<number>> {
    await this.db
      .delete(artifactReadmeTranslationChunks)
      .where(
        and(
          eq(artifactReadmeTranslationChunks.artifactId, artifactId),
          eq(artifactReadmeTranslationChunks.locale, locale),
          ne(artifactReadmeTranslationChunks.sourceHash, sourceHash),
        ),
      )
    const rows = await this.db
      .select({ chunkIndex: artifactReadmeTranslationChunks.chunkIndex })
      .from(artifactReadmeTranslationChunks)
      .where(
        and(
          eq(artifactReadmeTranslationChunks.artifactId, artifactId),
          eq(artifactReadmeTranslationChunks.locale, locale),
          eq(artifactReadmeTranslationChunks.sourceHash, sourceHash),
        ),
      )
    return new Set(rows.map((row) => row.chunkIndex))
  }

  async save(input: {
    readonly artifactId: Slug
    readonly locale: string
    readonly sourceHash: string
    readonly chunkIndex: number
    readonly chunkCount: number
    readonly text: string
  }): Promise<void> {
    const values = {
      ...input,
      artifactId: String(input.artifactId),
      updatedAt: new Date(),
    }
    await this.db
      .insert(artifactReadmeTranslationChunks)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          chunkCount: values.chunkCount,
          text: values.text,
          updatedAt: values.updatedAt,
        },
      })
  }

  async assemble(
    artifactId: Slug,
    locale: string,
    sourceHash: string,
    chunkCount: number,
  ): Promise<string | undefined> {
    const rows = await this.db
      .select({
        chunkIndex: artifactReadmeTranslationChunks.chunkIndex,
        chunkCount: artifactReadmeTranslationChunks.chunkCount,
        text: artifactReadmeTranslationChunks.text,
      })
      .from(artifactReadmeTranslationChunks)
      .where(
        and(
          eq(artifactReadmeTranslationChunks.artifactId, artifactId),
          eq(artifactReadmeTranslationChunks.locale, locale),
          eq(artifactReadmeTranslationChunks.sourceHash, sourceHash),
        ),
      )
      .orderBy(asc(artifactReadmeTranslationChunks.chunkIndex))

    if (
      rows.length !== chunkCount ||
      rows.some((row, index) => row.chunkIndex !== index || row.chunkCount !== chunkCount)
    ) {
      return undefined
    }
    return rows.map((row) => row.text).join('')
  }

  async clear(artifactId: Slug, locale: string, sourceHash: string): Promise<void> {
    await this.db
      .delete(artifactReadmeTranslationChunks)
      .where(
        and(
          eq(artifactReadmeTranslationChunks.artifactId, artifactId),
          eq(artifactReadmeTranslationChunks.locale, locale),
          eq(artifactReadmeTranslationChunks.sourceHash, sourceHash),
        ),
      )
  }
}
