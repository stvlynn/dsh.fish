import { describe, expect, it } from 'vitest'
import migrationSql from '../../../migrations/0004_artifact_source_commit_sha.sql?raw'
import readmeMigrationSql from '../../../migrations/0005_minor_ultimo.sql?raw'
import reviewsMigrationSql from '../../../migrations/0006_lucky_firestar.sql?raw'
import popularityMigrationSql from '../../../migrations/0008_artifact_popularity.sql?raw'
import searchMigrationSql from '../../../migrations/0009_flimsy_machine_man.sql?raw'
import facetIndexSql from '../../../migrations/0010_artifact_facet_covering_indexes.sql?raw'
import chunkMigrationSql from '../../../migrations/0012_famous_zemo.sql?raw'
import statsIndexSql from '../../../migrations/0013_artifact_stats_covering_index.sql?raw'
import tiebreakIndexSql from '../../../migrations/0014_artifact_popularity_tiebreak_index.sql?raw'
import journal from '../../../migrations/meta/_journal.json'
import {
  artifactReadmeTranslationChunks,
  artifactReadmeTranslations,
  artifactReviews,
  artifactSearchDocuments,
  artifactTopics,
  artifacts,
} from './catalog-schema.js'

/**
 * The schema, the migration and the journal are written by hand and must
 * agree: a column the mapper writes but the migration never adds fails only
 * against a real database, which these tests do not stand up.
 */
describe('artifacts.sourceCommitSha', () => {
  it('maps to the nullable column the 0004 migration adds', () => {
    expect(artifacts.sourceCommitSha.name).toBe('source_commit_sha')
    expect(artifacts.sourceCommitSha.notNull).toBe(false)

    expect(migrationSql).toContain('ALTER TABLE `artifacts` ADD `source_commit_sha` text;')
    expect(journal.entries.map((entry) => entry.tag)).toContain('0004_artifact_source_commit_sha')
  })
})

describe('artifact README translations', () => {
  it('keeps the schema, migration and journal in step', () => {
    expect(artifactReadmeTranslations.sourceHash.name).toBe('source_hash')
    expect(artifactReadmeTranslations.markdown.notNull).toBe(false)
    expect(readmeMigrationSql).toContain('CREATE TABLE `artifact_readme_translations`')
    expect(readmeMigrationSql).not.toContain('CREATE TABLE `artifact_metrics`')
    expect(journal.entries.map((entry) => entry.tag)).toContain('0005_minor_ultimo')
  })
})

describe('artifact README translation chunks', () => {
  it('keeps the resumable chunk schema, migration and journal in step', () => {
    expect(artifactReadmeTranslationChunks.chunkIndex.name).toBe('chunk_index')
    expect(artifactReadmeTranslationChunks.text.notNull).toBe(true)
    expect(chunkMigrationSql).toContain('CREATE TABLE `artifact_readme_translation_chunks`')
    expect(journal.entries.map((entry) => entry.tag)).toContain('0012_famous_zemo')
  })
})

describe('artifact popularity', () => {
  it('maps to the stored list-rank column the 0008 migration adds', () => {
    expect(artifacts.popularity.name).toBe('popularity')
    expect(artifacts.popularity.notNull).toBe(true)

    expect(popularityMigrationSql).toContain('ALTER TABLE `artifacts` ADD `popularity` real DEFAULT 0 NOT NULL')
    expect(popularityMigrationSql).toContain('CREATE INDEX `artifacts_popularity_idx`')
    expect(popularityMigrationSql).toContain('CREATE INDEX `artifacts_kind_popularity_idx`')
    expect(popularityMigrationSql).toContain('CREATE INDEX `artifacts_rising_idx`')
    expect(journal.entries.map((entry) => entry.tag)).toContain('0008_artifact_popularity')
  })
})

describe('artifact reviews', () => {
  it('keeps the schema, migration and journal in step', () => {
    expect(artifactReviews.artifactId.notNull).toBe(true)
    expect(artifactReviews.accountId.notNull).toBe(true)
    expect(artifactReviews.authorName.name).toBe('author_name')
    expect(artifactReviews.rating.notNull).toBe(true)
    expect(artifactReviews.comment.notNull).toBe(false)
    expect(reviewsMigrationSql).toContain('CREATE TABLE `artifact_reviews`')
    expect(reviewsMigrationSql).toContain('PRIMARY KEY(`artifact_id`, `account_id`)')
    expect(journal.entries.map((entry) => entry.tag)).toContain('0006_lucky_firestar')
  })
})

describe('locale-aware catalog search', () => {
  it('keeps exportable documents and derived FTS objects in one migration', () => {
    expect(artifactSearchDocuments.locale.notNull).toBe(true)
    expect(artifactTopics.topicId.notNull).toBe(true)
    expect(artifacts.summaryHash.name).toBe('summary_hash')
    expect(searchMigrationSql).toContain('CREATE TABLE `artifact_search_documents`')
    expect(searchMigrationSql).toContain('CREATE VIRTUAL TABLE `artifact_search_fts` USING fts5')
    expect(searchMigrationSql).toContain('CREATE TRIGGER `artifact_search_documents_au`')
    expect(searchMigrationSql).toContain("VALUES ('rebuild')")
    expect(journal.entries.map((entry) => entry.tag)).toContain('0009_flimsy_machine_man')
  })
})

describe('facet covering indexes', () => {
  it('keeps the schema, migration and journal in step', () => {
    expect(facetIndexSql).toContain(
      'CREATE INDEX `artifacts_deprecated_kind_idx` ON `artifacts` (`deprecated`,`kind`)',
    )
    expect(facetIndexSql).toContain(
      'CREATE INDEX `artifacts_deprecated_id_idx` ON `artifacts` (`deprecated`,`id`)',
    )
    expect(journal.entries.map((entry) => entry.tag)).toContain('0010_artifact_facet_covering_indexes')
  })
})

describe('catalog stats covering index', () => {
  it('keeps the schema, migration and journal in step', () => {
    expect(statsIndexSql).toContain(
      'CREATE INDEX `artifacts_deprecated_stats_idx` ON `artifacts` (`deprecated`,`updated_at`,`installs`,`stars`,`downloads`)',
    )
    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0013_artifact_stats_covering_index',
    )
  })
})

describe('popular sort tiebreak index', () => {
  it('keeps the schema, migration and journal in step', () => {
    expect(tiebreakIndexSql).toContain(
      'CREATE INDEX `artifacts_popularity_tiebreak_idx` ON `artifacts` (`deprecated`,`popularity`,`updated_at`,`id`)',
    )
    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0014_artifact_popularity_tiebreak_index',
    )
  })
})
