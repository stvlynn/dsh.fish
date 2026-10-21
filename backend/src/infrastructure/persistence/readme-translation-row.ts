import type { ReadmeTranslation, ReadmeTranslationStatus } from '../../domain/artifact/readme-translation.js'
import { slug } from '../../domain/shared/slug.js'
import type { artifactReadmeTranslations } from './catalog-schema.js'
type TranslationRow = typeof artifactReadmeTranslations.$inferSelect

export function toTranslation(row: TranslationRow): ReadmeTranslation {
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
