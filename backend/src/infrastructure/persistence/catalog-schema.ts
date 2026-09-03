import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Catalog tables. Better Auth owns its own tables in `auth-schema.ts`; the two
 * meet only through `artifacts.ownerAccountId`, which references a Better Auth
 * user id but is deliberately not a foreign key — deleting an account must not
 * cascade away a public catalog row, it must only unclaim it.
 */
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    displayName: text('display_name').notNull(),
    summary: text('summary').notNull(),
    /** Policy-aware digests used to invalidate stale localized projections. */
    summaryHash: text('summary_hash'),
    readmeHash: text('readme_hash'),
    /** JSON-encoded `SourceRef`. */
    source: text('source', { mode: 'json' }).notNull(),
    sourceOrigin: text('source_origin').notNull(),
    /**
     * Default-branch HEAD the indexer last scanned, when the source is a git
     * repository. Denormalized out of `source.commit` so the install plan and
     * the detail page can show scan provenance without parsing the JSON.
     */
    sourceCommitSha: text('source_commit_sha'),
    /** JSON-encoded `ArtifactPayload`. */
    payload: text('payload', { mode: 'json' }).notNull(),
    keywords: text('keywords', { mode: 'json' }).notNull(),
    categories: text('categories', { mode: 'json' }).notNull(),
    license: text('license'),
    authorName: text('author_name'),
    authorUrl: text('author_url'),
    readmeMarkdown: text('readme_markdown'),
    /** GitHub Social preview URL; null when the source has none. */
    ogImageUrl: text('og_image_url'),
    stars: integer('stars').notNull().default(0),
    downloads: integer('downloads').notNull().default(0),
    installs: integer('installs').notNull().default(0),
    /** Stars gained over the trailing 7 / 30 days, recomputed on each ingestion sweep. */
    starVelocity7d: integer('star_velocity_7d').notNull().default(0),
    starVelocity30d: integer('star_velocity_30d').notNull().default(0),
    /**
     * Materialized `listRank` so a listing `ORDER BY` is a column scan.
     * Written on every catalog save, metrics snapshot, and install increment.
     */
    popularity: real('popularity').notNull().default(0),
    ownerAccountId: text('owner_account_id'),
    deprecated: integer('deprecated', { mode: 'boolean' }).notNull().default(false),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('artifacts_kind_idx').on(table.kind),
    index('artifacts_origin_idx').on(table.sourceOrigin),
    index('artifacts_owner_idx').on(table.ownerAccountId),
    index('artifacts_updated_idx').on(table.updatedAt),
    index('artifacts_popularity_idx').on(table.deprecated, table.popularity),
    index('artifacts_kind_popularity_idx').on(table.kind, table.deprecated, table.popularity),
    index('artifacts_rising_idx').on(table.deprecated, table.starVelocity7d, table.popularity),
    // Facet COUNTs must not visit the wide row (readme_markdown). These two
    // covering indexes satisfy `WHERE deprecated = 0 GROUP BY kind` and the
    // live-id semi-join used by category/topic counts.
    index('artifacts_deprecated_kind_idx').on(table.deprecated, table.kind),
    index('artifacts_deprecated_id_idx').on(table.deprecated, table.id),
    // Home `sort=recent` is `WHERE deprecated = 0 ORDER BY updated_at DESC`.
    // `artifacts_updated_idx` is only `(updated_at)`, so SQLite scanned the
    // wide table (15k rows_read / ~700ms) instead of walking an index.
    index('artifacts_deprecated_updated_idx').on(table.deprecated, table.updatedAt),
  ],
)

/**
 * Category membership, normalized so browsing by category is an index scan
 * rather than a JSON scan over every row.
 */
export const artifactCategories = sqliteTable(
  'artifact_categories',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.categoryId] }),
    index('artifact_categories_category_idx').on(table.categoryId),
  ],
)

/** Curated user-intent topics, independent from the broad category taxonomy. */
export const artifactTopics = sqliteTable(
  'artifact_topics',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.topicId] }),
    index('artifact_topics_topic_idx').on(table.topicId),
  ],
)

export const submissions = sqliteTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    kind: text('kind').notNull(),
    source: text('source', { mode: 'json' }).notNull(),
    /** Stable digest of the source, so a duplicate pending submission is one lookup. */
    sourceKey: text('source_key').notNull(),
    note: text('note'),
    status: text('status').notNull(),
    reviewerNote: text('reviewer_note'),
    artifactId: text('artifact_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('submissions_account_idx').on(table.accountId),
    index('submissions_status_idx').on(table.status),
    index('submissions_source_key_idx').on(table.sourceKey),
  ],
)

/**
 * Community ratings and comments, one row per (artifact, account) — rating
 * again replaces the row. The reviewer name and avatar are snapshots taken at
 * rating time: a review is a public statement that should survive an account
 * rename or deletion unchanged, and joining back to Better Auth's `users`
 * would couple the catalog's read path to identity storage.
 */
export const artifactReviews = sqliteTable(
  'artifact_reviews',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    /** A Better Auth user id, deliberately not a foreign key — see above. */
    accountId: text('account_id').notNull(),
    authorName: text('author_name').notNull(),
    authorAvatarUrl: text('author_avatar_url'),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.accountId] }),
    index('artifact_reviews_account_idx').on(table.accountId),
  ],
)

/**
 * Full-text index over the catalog.
 *
 * D1 is SQLite, so FTS5 is available and is what makes search a real ranked
 * query rather than a `LIKE '%…%'` scan. The table is kept in step by the
 * repository on every write; SQLite triggers would be tidier but D1 migrations
 * apply them inconsistently across local and remote, so the write path owns it.
 */
export const artifactSearch = sqliteTable('artifact_search', {
  artifactId: text('artifact_id').primaryKey(),
  /** Lowercased `displayName + summary + keywords`, searched with LIKE fallbacks. */
  haystack: text('haystack').notNull(),
})

/** Exportable source-of-truth documents mirrored by the derived FTS5 table. */
export const artifactSearchDocuments = sqliteTable(
  'artifact_search_documents',
  {
    rowid: integer('rowid').primaryKey({ autoIncrement: true }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    displayName: text('display_name').notNull(),
    summary: text('summary').notNull(),
    keywords: text('keywords').notNull(),
    topics: text('topics').notNull(),
    summaryHash: text('summary_hash').notNull(),
    readmeHash: text('readme_hash'),
  },
  (table) => [
    uniqueIndex('artifact_search_documents_artifact_locale_idx').on(
      table.artifactId,
      table.locale,
    ),
    index('artifact_search_documents_locale_idx').on(table.locale),
  ],
)

/**
 * One row per artifact per ingestion sweep. The history is what star velocity
 * is computed against: the anchor for a 7- or 30-day window is the most
 * recent snapshot taken at least that long ago.
 */
export const artifactMetrics = sqliteTable(
  'artifact_metrics',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    downloads: integer('downloads').notNull(),
    installs: integer('installs').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.capturedAt] })],
)

/**
 * Generated README translations, one current result per artifact and locale.
 *
 * The source hash identifies which upstream README and translation policy
 * produced the row so a replacement can be queued. Readers keep the last
 * completed body until that replacement finishes.
 */
export const artifactReadmeTranslations = sqliteTable(
  'artifact_readme_translations',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    sourceHash: text('source_hash').notNull(),
    status: text('status').notNull(),
    markdown: text('markdown'),
    error: text('error'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.locale] }),
    index('artifact_readme_translations_status_idx').on(table.status),
  ],
)

/**
 * Generated summary translations, one current result per artifact and locale.
 *
 * Same contract as the README table: the source hash identifies which
 * upstream summary and policy produced the row. Readers keep the last
 * completed body until a replacement finishes. Terminal failures stay in D1
 * because the queue has no dead-letter queue.
 */
export const artifactSummaryTranslations = sqliteTable(
  'artifact_summary_translations',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    sourceHash: text('source_hash').notNull(),
    status: text('status').notNull(),
    text: text('text'),
    error: text('error'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.locale] }),
    index('artifact_summary_translations_status_idx').on(table.status),
  ],
)
