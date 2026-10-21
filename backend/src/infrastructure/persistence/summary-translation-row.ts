import type { SummaryTranslation, SummaryTranslationStatus } from '../../domain/artifact/summary-translation.js'
import { slug } from '../../domain/shared/slug.js'
import type { artifactSummaryTranslations } from './catalog-schema.js'
type TranslationRow = typeof artifactSummaryTranslations.$inferSelect

export function toTranslation(row: TranslationRow): SummaryTranslation {
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
