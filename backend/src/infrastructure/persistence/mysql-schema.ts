import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  double,
  index,
  json,
  longtext,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

/** Preserve the existing epoch-millisecond storage contract while exposing Dates. */
const epochMilliseconds = customType<{ data: Date; driverData: number | string }>({
  dataType: () => 'bigint',
  toDriver: (value) => value.getTime(),
  fromDriver: (value) => new Date(Number(value)),
})

/**
 * Catalog tables. Better Auth owns its own tables in `auth-schema.ts`; the two
 * meet only through `artifacts.ownerAccountId`, which references a Better Auth
 * user id but is deliberately not a foreign key — deleting an account must not
 * cascade away a public catalog row, it must only unclaim it.
 */
export const artifacts = mysqlTable(
  'artifacts',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull(),
    displayName: longtext('display_name').notNull(),
    summary: longtext('summary').notNull(),
    /** Policy-aware digests used to invalidate stale localized projections. */
    summaryHash: longtext('summary_hash'),
    readmeHash: longtext('readme_hash'),
    /** JSON-encoded `SourceRef`. */
    source: json('source').notNull(),
    sourceOrigin: varchar('source_origin', { length: 32 }).notNull(),
    /**
     * Default-branch HEAD the indexer last scanned, when the source is a git
     * repository. Denormalized out of `source.commit` so the install plan and
     * the detail page can show scan provenance without parsing the JSON.
     */
    sourceCommitSha: longtext('source_commit_sha'),
    /** JSON-encoded `ArtifactPayload`. */
    payload: json('payload').notNull(),
    keywords: json('keywords').notNull(),
    categories: json('categories').notNull(),
    license: longtext('license'),
    authorName: longtext('author_name'),
    authorUrl: longtext('author_url'),
    readmeMarkdown: longtext('readme_markdown'),
    /** GitHub Social preview URL; null when the source has none. */
    ogImageUrl: longtext('og_image_url'),
    stars: bigint('stars', { mode: 'number' }).notNull().default(0),
    downloads: bigint('downloads', { mode: 'number' }).notNull().default(0),
    installs: bigint('installs', { mode: 'number' }).notNull().default(0),
    /** Stars gained over the trailing 7 / 30 days, recomputed on each ingestion sweep. */
    starVelocity7d: bigint('star_velocity_7d', { mode: 'number' }).notNull().default(0),
    starVelocity30d: bigint('star_velocity_30d', { mode: 'number' }).notNull().default(0),
    /**
     * Materialized `listRank` so a listing `ORDER BY` is a column scan.
     * Written on every catalog save, metrics snapshot, and install increment.
     */
    popularity: double('popularity').notNull().default(0),
    ownerAccountId: varchar('owner_account_id', { length: 255 }),
    deprecated: boolean('deprecated').notNull().default(false),
    publishedAt: epochMilliseconds('published_at').notNull(),
    updatedAt: epochMilliseconds('updated_at').notNull(),
    indexedAt: epochMilliseconds('indexed_at').notNull(),
  },
  (table) => [
    index('artifacts_kind_idx').on(table.kind),
    index('artifacts_origin_idx').on(table.sourceOrigin),
    index('artifacts_owner_idx').on(table.ownerAccountId),
    index('artifacts_updated_idx').on(table.updatedAt),
    index('artifacts_popularity_idx').on(table.deprecated, table.popularity),
    // `sort=popular` orders by `popularity, updated_at, id`. An index on
    // `(deprecated, popularity)` alone cannot satisfy that: SQLite fell back
    // to `(deprecated, updated_at)` and then sorted 22k rows in a temporary
    // B-tree (~850 ms, 22,039 rows_read) where `sort=rising` — whose index
    // matches its sort key — reads 25 rows in 0.5 ms. Same pattern the rising
    // index already established.
    index('artifacts_popularity_tiebreak_idx').on(
      table.deprecated,
      table.popularity,
      table.updatedAt,
      table.id,
    ),
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
    // `/api/v1/catalog/version` and `/catalog/snapshot` aggregate
    // `count(*)`, `max(updated_at)` and `sum(installs|stars|downloads)` over
    // `WHERE deprecated = 0`. Without this index SQLite walks every heap row
    // — and `readme_markdown` is stored inline, so one row is tens of
    // kilobytes — which is enough on its own to exhaust D1's CPU budget.
    index('artifacts_deprecated_stats_idx').on(
      table.deprecated,
      table.updatedAt,
      table.installs,
      table.stars,
      table.downloads,
    ),
  ],
)

/**
 * Category membership, normalized so browsing by category is an index scan
 * rather than a JSON scan over every row.
 */
export const artifactCategories = mysqlTable(
  'artifact_categories',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    categoryId: varchar('category_id', { length: 255 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.categoryId] }),
    index('artifact_categories_category_idx').on(table.categoryId),
  ],
)

/** Curated user-intent topics, independent from the broad category taxonomy. */
export const artifactTopics = mysqlTable(
  'artifact_topics',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    topicId: varchar('topic_id', { length: 255 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.topicId] }),
    index('artifact_topics_topic_idx').on(table.topicId),
  ],
)

/**
 * Pre-aggregated filter-rail counts: one row per (dimension, facet id) for the
 * live (non-deprecated) catalog. `dimension` is `kind`, `category` or `topic`.
 *
 * The rails used to be three `GROUP BY` aggregations over `artifacts`,
 * `artifact_categories` and `artifact_topics` — about 150k rows read per
 * refresh no matter which index served them, because `deprecated = 0` matches
 * nearly every row. The table is rebuilt in one atomic batch by
 * `D1ArtifactRepository.refreshFacetCounts`; a rail read is a ~50-row scan.
 */
export const catalogFacetCounts = mysqlTable(
  'catalog_facet_counts',
  {
    dimension: varchar('dimension', { length: 32 }).notNull(),
    facetId: varchar('facet_id', { length: 191 }).notNull(),
    count: bigint('count', { mode: 'number' }).notNull(),
    refreshedAt: epochMilliseconds('refreshed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.dimension, table.facetId] })],
)

export const submissions = mysqlTable(
  'submissions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    source: json('source').notNull(),
    /** Stable digest of the source, so a duplicate pending submission is one lookup. */
    sourceKey: longtext('source_key').notNull(),
    note: longtext('note'),
    status: varchar('status', { length: 255 }).notNull(),
    reviewerNote: longtext('reviewer_note'),
    artifactId: varchar('artifact_id', { length: 255 }),
    createdAt: epochMilliseconds('created_at').notNull(),
    decidedAt: epochMilliseconds('decided_at'),
  },
  (table) => [
    index('submissions_account_idx').on(table.accountId),
    index('submissions_status_idx').on(table.status),
    index('submissions_source_key_idx').on(sql`${table.sourceKey}(191)`),
  ],
)

/**
 * Community ratings and comments, one row per (artifact, account) — rating
 * again replaces the row. The reviewer name and avatar are snapshots taken at
 * rating time: a review is a public statement that should survive an account
 * rename or deletion unchanged, and joining back to Better Auth's `users`
 * would couple the catalog's read path to identity storage.
 */
export const artifactReviews = mysqlTable(
  'artifact_reviews',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    /** A Better Auth user id, deliberately not a foreign key — see above. */
    accountId: varchar('account_id', { length: 255 }).notNull(),
    authorName: longtext('author_name').notNull(),
    authorAvatarUrl: longtext('author_avatar_url'),
    rating: bigint('rating', { mode: 'number' }).notNull(),
    comment: longtext('comment'),
    createdAt: epochMilliseconds('created_at').notNull(),
    updatedAt: epochMilliseconds('updated_at').notNull(),
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
export const artifactSearch = mysqlTable('artifact_search', {
  artifactId: varchar('artifact_id', { length: 255 }).primaryKey(),
  /** Lowercased `displayName + summary + keywords`, searched with LIKE fallbacks. */
  haystack: longtext('haystack').notNull(),
})

/** Exportable source-of-truth documents mirrored by the derived FTS5 table. */
export const artifactSearchDocuments = mysqlTable(
  'artifact_search_documents',
  {
    rowid: bigint('rowid', { mode: 'number' }).autoincrement().primaryKey(),
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 32 }).notNull(),
    displayName: longtext('display_name').notNull(),
    summary: longtext('summary').notNull(),
    keywords: longtext('keywords').notNull(),
    topics: longtext('topics').notNull(),
    summaryHash: longtext('summary_hash').notNull(),
    readmeHash: longtext('readme_hash'),
  },
  (table) => [
    uniqueIndex('artifact_search_documents_artifact_locale_idx').on(table.artifactId, table.locale),
    index('artifact_search_documents_locale_idx').on(table.locale),
  ],
)

/**
 * One row per artifact per ingestion sweep. The history is what star velocity
 * is computed against: the anchor for a 7- or 30-day window is the most
 * recent snapshot taken at least that long ago.
 */
export const artifactMetrics = mysqlTable(
  'artifact_metrics',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    stars: bigint('stars', { mode: 'number' }).notNull(),
    downloads: bigint('downloads', { mode: 'number' }).notNull(),
    installs: bigint('installs', { mode: 'number' }).notNull(),
    capturedAt: epochMilliseconds('captured_at').notNull(),
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
export const artifactReadmeTranslations = mysqlTable(
  'artifact_readme_translations',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 32 }).notNull(),
    sourceHash: varchar('source_hash', { length: 96 }).notNull(),
    status: varchar('status', { length: 255 }).notNull(),
    markdown: longtext('markdown'),
    error: longtext('error'),
    updatedAt: epochMilliseconds('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.locale] }),
    index('artifact_readme_translations_status_idx').on(table.status),
  ],
)

/**
 * Temporary, resumable README translation output.
 *
 * Rows are deleted after the ordered chunks have been assembled into the
 * current translation, so large catalogs do not permanently duplicate README
 * storage. The source hash isolates an in-flight job from a newer README.
 */
export const artifactReadmeTranslationChunks = mysqlTable(
  'artifact_readme_translation_chunks',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 32 }).notNull(),
    sourceHash: varchar('source_hash', { length: 96 }).notNull(),
    chunkIndex: bigint('chunk_index', { mode: 'number' }).notNull(),
    chunkCount: bigint('chunk_count', { mode: 'number' }).notNull(),
    text: longtext('text').notNull(),
    updatedAt: epochMilliseconds('updated_at').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.artifactId, table.locale, table.sourceHash, table.chunkIndex],
    }),
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
export const artifactSummaryTranslations = mysqlTable(
  'artifact_summary_translations',
  {
    artifactId: varchar('artifact_id', { length: 255 })
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 32 }).notNull(),
    sourceHash: varchar('source_hash', { length: 96 }).notNull(),
    status: varchar('status', { length: 255 }).notNull(),
    text: longtext('text'),
    error: longtext('error'),
    updatedAt: epochMilliseconds('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.locale] }),
    index('artifact_summary_translations_status_idx').on(table.status),
  ],
)

export const users = mysqlTable('users', {
  id: varchar('id', { length: 255 }).primaryKey(),
  name: longtext('name').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: longtext('image'),
  createdAt: epochMilliseconds('created_at')
    .default(sql`(unix_timestamp(current_timestamp(3)) * 1000)`)
    .notNull(),
  updatedAt: epochMilliseconds('updated_at')
    .default(sql`(unix_timestamp(current_timestamp(3)) * 1000)`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    expiresAt: epochMilliseconds('expires_at').notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: epochMilliseconds('created_at')
      .default(sql`(unix_timestamp(current_timestamp(3)) * 1000)`)
      .notNull(),
    updatedAt: epochMilliseconds('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: longtext('ip_address'),
    userAgent: longtext('user_agent'),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [index('sessions_userId_idx').on(table.userId)],
)

export const accounts = mysqlTable(
  'accounts',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    providerId: longtext('provider_id').notNull(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: longtext('access_token'),
    refreshToken: longtext('refresh_token'),
    idToken: longtext('id_token'),
    accessTokenExpiresAt: epochMilliseconds('access_token_expires_at'),
    refreshTokenExpiresAt: epochMilliseconds('refresh_token_expires_at'),
    scope: longtext('scope'),
    password: longtext('password'),
    createdAt: epochMilliseconds('created_at')
      .default(sql`(unix_timestamp(current_timestamp(3)) * 1000)`)
      .notNull(),
    updatedAt: epochMilliseconds('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('accounts_userId_idx').on(table.userId)],
)

export const verifications = mysqlTable(
  'verifications',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: longtext('value').notNull(),
    expiresAt: epochMilliseconds('expires_at').notNull(),
    createdAt: epochMilliseconds('created_at')
      .default(sql`(unix_timestamp(current_timestamp(3)) * 1000)`)
      .notNull(),
    updatedAt: epochMilliseconds('updated_at')
      .default(sql`(unix_timestamp(current_timestamp(3)) * 1000)`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
)

export const deviceCodes = mysqlTable('device_codes', {
  id: varchar('id', { length: 255 }).primaryKey(),
  deviceCode: longtext('device_code').notNull(),
  userCode: longtext('user_code').notNull(),
  userId: varchar('user_id', { length: 255 }),
  expiresAt: epochMilliseconds('expires_at').notNull(),
  status: varchar('status', { length: 255 }).notNull(),
  lastPolledAt: epochMilliseconds('last_polled_at'),
  pollingInterval: bigint('polling_interval', { mode: 'number' }),
  clientId: longtext('client_id'),
  scope: longtext('scope'),
})

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  users: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  users: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}))
