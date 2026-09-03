import { and, asc, desc, eq, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactProps } from '../../domain/artifact/artifact.js'
import { artifactKind } from '../../domain/artifact/artifact-kind.js'
import type { ArtifactPayload } from '../../domain/artifact/artifact-payload.js'
import type {
  ArtifactQuery,
  ArtifactRepository,
  CatalogStats,
  KindCount,
  SitemapEntry,
  TaxonomyCount,
} from '../../domain/artifact/artifact-repository.js'
import { inferTopics, normalizeSearchText, topicSearchText } from '../../domain/artifact/topic.js'
import { starVelocity } from '../../domain/artifact/quality-score.js'
import type { MetricsSnapshot } from '../../domain/artifact/quality-score.js'
import type { SourceRef } from '../../domain/artifact/source-ref.js'
import type { Page, PageRequest } from '../../domain/shared/pagination.js'
import { page } from '../../domain/shared/pagination.js'
import type { Slug } from '../../domain/shared/slug.js'
import { slug } from '../../domain/shared/slug.js'
import { readmeDigest } from '../../application/lib/readme-digest.js'
import {
  artifactCategories,
  artifactMetrics,
  artifactReadmeTranslations,
  artifactSearch,
  artifactSearchDocuments,
  artifactSummaryTranslations,
  artifactTopics,
  artifacts,
} from './catalog-schema.js'
import * as schema from './schema.js'

type Db = DrizzleD1Database<typeof schema>
type ArtifactRow = typeof artifacts.$inferSelect
/** One statement in a D1 batch. Drizzle types each builder differently, so the
 *  heterogeneous list needs the shared base type to stay assignable. */
type BatchStatement = BatchItem<'sqlite'>

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * D1 implementation of the catalog port.
 *
 * D1 has no server-side transactions across statements, so multi-table writes
 * go through `db.batch`, which D1 does apply atomically. That matters for the
 * artifact + categories + search-index triple: a half-applied write would leave
 * a row that browses but never appears in search.
 */
export class D1ArtifactRepository implements ArtifactRepository {
  constructor(
    private readonly db: Db,
    private readonly ftsSearchEnabled = false,
  ) {}

  async findById(id: Slug): Promise<Artifact | undefined> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1)
    const row = rows[0]
    return row ? toEntity(row) : undefined
  }

  /**
   * Catalog listings page in SQL (`LIMIT`/`OFFSET` plus a `COUNT(*)`), not in
   * the Worker. The sort key is the stored `popularity` column — matching
   * `listRank` — so D1 can satisfy default browse from an index instead of
   * evaluating an expression over every row. The projection omits README text.
   */
  async search(query: ArtifactQuery): Promise<Page<Artifact>> {
    const conditions = []

    if (query.kinds && query.kinds.length > 0) {
      conditions.push(inArray(artifacts.kind, [...query.kinds]))
    }
    if (query.verifiedOnly === true) {
      conditions.push(sql`${artifacts.ownerAccountId} is not null`)
    }
    if (query.includeDeprecated !== true) {
      conditions.push(eq(artifacts.deprecated, false))
    }
    if (query.ownerAccountId !== undefined) {
      conditions.push(eq(artifacts.ownerAccountId, query.ownerAccountId))
    }
    if (query.text !== undefined) {
      const normalized = normalizeSearchText(query.text)
      const needle = `%${normalized}%`
      const locale = query.locale ?? 'und'
      // `%LIKE%` cannot use a B-tree index (Cloudflare D1: leading wildcard
      // scans the table). FTS5 is the documented path once the derived index
      // is populated; keep LIKE only as the short-query / rollback fallback.
      const useFts = usesFtsIndex(this.ftsSearchEnabled, normalized)
      const documentMatch = useFts
        ? sql`exists (
            select 1 from artifact_search_fts
            join artifact_search_documents d on d.rowid = artifact_search_fts.rowid
            where d.artifact_id = ${artifacts.id}
              and d.locale in (${locale}, 'und')
              and artifact_search_fts match ${ftsQuery(normalized)}
          )`
        : sql`exists (
            select 1 from ${artifactSearchDocuments} d
            where d.artifact_id = ${artifacts.id}
              and d.locale in (${locale}, 'und')
              and (d.display_name like ${needle} or d.summary like ${needle}
                or d.keywords like ${needle} or d.topics like ${needle})
          )`
      conditions.push(
        useFts
          ? or(like(sql`lower(${artifacts.id})`, needle), documentMatch)
          : or(
              like(sql`lower(${artifacts.id})`, needle),
              documentMatch,
              sql`exists (select 1 from ${artifactSearch} where ${artifactSearch.artifactId} = ${artifacts.id} and ${artifactSearch.haystack} like ${needle})`,
            ),
      )
    }
    if (query.categories && query.categories.length > 0) {
      conditions.push(
        sql`exists (select 1 from ${artifactCategories} where ${artifactCategories.artifactId} = ${artifacts.id} and ${artifactCategories.categoryId} in ${[...query.categories]})`,
      )
    }
    if (query.topics && query.topics.length > 0) {
      conditions.push(
        sql`exists (select 1 from ${artifactTopics} where ${artifactTopics.artifactId} = ${artifacts.id} and ${artifactTopics.topicId} in ${[...query.topics]})`,
      )
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const order = orderFor(query, this.ftsSearchEnabled)

    // Count + page in one D1 batch: a Worker round trip to D1 dominates, and
    // browse loaders already spend that budget on facets as well.
    const countQuery = this.db
      .select({ total: sql<number>`count(*)` })
      .from(artifacts)
      .where(where)
    const pageQuery = this.db
      .select(listingColumns)
      .from(artifacts)
      .where(where)
      .orderBy(...order)
      .limit(query.page.limit)
      .offset(query.page.offset)
    const [countRows, pageRows] = await this.db.batch([countQuery, pageQuery])

    return page(pageRows.map(toListingEntity), Number(countRows[0]?.total ?? 0), query.page)
  }

  async countByKind(): Promise<readonly KindCount[]> {
    const rows = await this.db
      .select({ kind: artifacts.kind, count: sql<number>`count(*)` })
      .from(artifacts)
      .where(eq(artifacts.deprecated, false))
      .groupBy(artifacts.kind)
    return rows.map((row) => ({ kind: artifactKind(row.kind), count: Number(row.count) }))
  }

  async countByCategory(): Promise<readonly TaxonomyCount[]> {
    const rows = await this.db
      .select({ id: artifactCategories.categoryId, count: sql<number>`count(*)` })
      .from(artifactCategories)
      .where(inArray(artifactCategories.artifactId, this.liveArtifactIds()))
      .groupBy(artifactCategories.categoryId)
    return rows.map((row) => ({ id: row.id, count: Number(row.count) }))
  }

  async countByTopic(): Promise<readonly TaxonomyCount[]> {
    const rows = await this.db
      .select({ id: artifactTopics.topicId, count: sql<number>`count(*)` })
      .from(artifactTopics)
      .where(inArray(artifactTopics.artifactId, this.liveArtifactIds()))
      .groupBy(artifactTopics.topicId)
    return rows.map((row) => ({ id: row.id, count: Number(row.count) }))
  }

  /** Covering `(deprecated, id)` — never visits `readme_markdown`. */
  private liveArtifactIds() {
    return this.db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.deprecated, false))
  }

  async listAvailableLocales(id: Slug) {
    const rows = await this.db
      .select({
        locale: artifactSummaryTranslations.locale,
        summaryUpdatedAt: artifactSummaryTranslations.updatedAt,
        readmeUpdatedAt: artifactReadmeTranslations.updatedAt,
      })
      .from(artifactSummaryTranslations)
      .innerJoin(artifacts, eq(artifacts.id, artifactSummaryTranslations.artifactId))
      .leftJoin(
        artifactReadmeTranslations,
        and(
          eq(artifactReadmeTranslations.artifactId, artifactSummaryTranslations.artifactId),
          eq(artifactReadmeTranslations.locale, artifactSummaryTranslations.locale),
        ),
      )
      .where(
        and(
          eq(artifactSummaryTranslations.artifactId, id),
          displayableLocalizedProse(),
        ),
      )
    return rows.map((row) => ({
      locale: row.locale,
      updatedAt:
        row.readmeUpdatedAt !== null && row.readmeUpdatedAt > row.summaryUpdatedAt
          ? row.readmeUpdatedAt
          : row.summaryUpdatedAt,
    }))
  }

  /** Rebuild one locale document when that locale still has generated prose to show. */
  async refreshLocalizedSearchDocument(id: Slug, locale: string): Promise<void> {
    const artifact = await this.findById(id)
    if (!artifact) return
    const available = await this.listAvailableLocales(id)
    if (!available.some((entry) => entry.locale === locale)) {
      await this.db
        .delete(artifactSearchDocuments)
        .where(
          and(
            eq(artifactSearchDocuments.artifactId, id),
            eq(artifactSearchDocuments.locale, locale),
          ),
        )
      return
    }

    const [summaryRow] = await this.db
      .select({ text: artifactSummaryTranslations.text })
      .from(artifactSummaryTranslations)
      .where(
        and(
          eq(artifactSummaryTranslations.artifactId, id),
          eq(artifactSummaryTranslations.locale, locale),
        ),
      )
      .limit(1)
    if (summaryRow?.text === null || summaryRow?.text === undefined) return
    const props = artifact.toProps()
    const topics = inferTopics({
      keywords: props.keywords,
      text: [props.displayName, props.summary, props.readmeMarkdown ?? ''].join(' '),
    })
    await this.db
      .insert(artifactSearchDocuments)
      .values({
        artifactId: String(id),
        locale,
        displayName: normalizeSearchText(props.displayName),
        summary: normalizeSearchText(summaryRow.text),
        keywords: normalizeSearchText(props.keywords.join(' ')),
        topics: normalizeSearchText(topicSearchText(topics)),
        summaryHash: await readmeDigest(props.summary),
        readmeHash:
          props.readmeMarkdown === undefined ? null : await readmeDigest(props.readmeMarkdown),
      })
      .onConflictDoUpdate({
        target: [artifactSearchDocuments.artifactId, artifactSearchDocuments.locale],
        set: {
          summary: normalizeSearchText(summaryRow.text),
          keywords: normalizeSearchText(props.keywords.join(' ')),
          topics: normalizeSearchText(topicSearchText(topics)),
        },
      })
  }

  /** Idempotent metadata backfill used after adding hashes, topics or search projections. */
  async refreshSearchMetadata(id: Slug): Promise<void> {
    const artifact = await this.findById(id)
    if (!artifact) return
    await this.runBatch(await this.writeStatements(artifact))
  }

  async save(artifact: Artifact): Promise<void> {
    await this.runBatch(await this.writeStatements(artifact))
  }

  async saveMany(list: readonly Artifact[]): Promise<void> {
    if (list.length === 0) return
    const statements = (await Promise.all(list.map((artifact) => this.writeStatements(artifact)))).flat()
    // D1 caps the number of statements in one batch; chunk so a large crawl
    // cannot exceed it.
    for (let index = 0; index < statements.length; index += 50) {
      await this.runBatch(statements.slice(index, index + 50))
    }
  }

  /** `db.batch` demands a non-empty tuple; an empty slice is simply a no-op. */
  private async runBatch(statements: BatchStatement[]): Promise<void> {
    const [first, ...rest] = statements
    if (!first) return
    await this.db.batch([first, ...rest])
  }

  async incrementInstalls(id: Slug, by: number): Promise<void> {
    await this.db
      .update(artifacts)
      .set({
        installs: sql`${artifacts.installs} + ${by}`,
        // SQLite SET expressions read the pre-update row, so the rank uses
        // `installs + by` rather than the column after this statement.
        popularity: popularityFromColumns(sql`${artifacts.installs} + ${by}`),
      })
      .where(eq(artifacts.id, id))
  }

  async recordMetricsSnapshot(artifact: Artifact): Promise<void> {
    const props = artifact.toProps()
    const now = new Date()

    // The anchor for a window is the most recent snapshot taken at least that
    // long ago; the rule itself lives in the domain (`starVelocity`) so the
    // SQL below only fetches candidates.
    const anchorHistory = async (windowDays: number): Promise<readonly MetricsSnapshot[]> => {
      const cutoff = new Date(now.getTime() - windowDays * DAY_MS)
      return this.db
        .select({ stars: artifactMetrics.stars, capturedAt: artifactMetrics.capturedAt })
        .from(artifactMetrics)
        .where(and(eq(artifactMetrics.artifactId, props.id as string), lte(artifactMetrics.capturedAt, cutoff)))
        .orderBy(desc(artifactMetrics.capturedAt))
        .limit(1)
    }
    const [history7d, history30d] = await Promise.all([anchorHistory(7), anchorHistory(30)])

    const snapshot = this.db
      .insert(artifactMetrics)
      .values({
        artifactId: props.id as string,
        stars: props.stats.stars,
        downloads: props.stats.downloads,
        installs: props.stats.installs,
        capturedAt: now,
      })
      // Two sweeps inside the same millisecond must not fail the second one.
      .onConflictDoNothing()
    const velocities = this.db
      .update(artifacts)
      .set({
        // Also refreshes the displayed counters: a sweep that changed only
        // stats skips the full catalog write, so this one UPDATE is what keeps
        // the stored stars/downloads from going stale.
        stars: props.stats.stars,
        downloads: props.stats.downloads,
        starVelocity7d: starVelocity(props.stats.stars, history7d, 7, now),
        starVelocity30d: starVelocity(props.stats.stars, history30d, 30, now),
        popularity: artifact.popularity,
      })
      .where(eq(artifacts.id, props.id as string))
    await this.db.batch([snapshot, velocities])
  }

  async listForSitemap(request: PageRequest): Promise<Page<SitemapEntry>> {
    // A deprecated artifact still resolves and is still linked from the pages
    // that reference it, but it is not something to invite a crawler to.
    const where = eq(artifacts.deprecated, false)

    const countQuery = this.db
      .select({ total: sql<number>`count(*)` })
      .from(artifacts)
      .where(where)
    const pageQuery = this.db
      .select({ id: artifacts.id, updatedAt: artifacts.updatedAt })
      .from(artifacts)
      .where(where)
      .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
      .limit(request.limit)
      .offset(request.offset)
    const [countRows, pageRows] = await this.db.batch([countQuery, pageQuery])

    const ids = pageRows.map((row) => row.id)
    const localeRows =
      ids.length === 0
        ? []
        : await this.db
            .select({
              artifactId: artifactSummaryTranslations.artifactId,
              locale: artifactSummaryTranslations.locale,
              summaryUpdatedAt: artifactSummaryTranslations.updatedAt,
              readmeUpdatedAt: artifactReadmeTranslations.updatedAt,
            })
            .from(artifactSummaryTranslations)
            .innerJoin(artifacts, eq(artifacts.id, artifactSummaryTranslations.artifactId))
            .leftJoin(
              artifactReadmeTranslations,
              and(
                eq(
                  artifactReadmeTranslations.artifactId,
                  artifactSummaryTranslations.artifactId,
                ),
                eq(artifactReadmeTranslations.locale, artifactSummaryTranslations.locale),
              ),
            )
            .where(
              and(
                // D1 allows at most 100 bound parameters per statement. A
                // sitemap page contains 1,000 artifacts, so expanding `ids`
                // with `inArray` makes the whole endpoint fail before it can
                // emit XML. `json_each` keeps the complete page in one query
                // while binding the id set as a single JSON value.
                sql`${artifactSummaryTranslations.artifactId} in (select value from json_each(${JSON.stringify(ids)}))`,
                displayableLocalizedProse(),
              ),
            )
    const localesByArtifact = new Map<string, { locale: string; updatedAt: Date }[]>()
    for (const row of localeRows) {
      const list = localesByArtifact.get(row.artifactId) ?? []
      list.push({
        locale: row.locale,
        updatedAt:
          row.readmeUpdatedAt !== null && row.readmeUpdatedAt > row.summaryUpdatedAt
            ? row.readmeUpdatedAt
            : row.summaryUpdatedAt,
      })
      localesByArtifact.set(row.artifactId, list)
    }

    // `updated_at` is a `timestamp_ms` column, so Drizzle hands back a Date.
    return page(
      pageRows.map((row) => ({
        id: slug(row.id),
        updatedAt: row.updatedAt,
        locales: localesByArtifact.get(row.id) ?? [],
      })),
      Number(countRows[0]?.total ?? 0),
      request,
    )
  }

  async listIdsByOrigin(origin: string): Promise<readonly Slug[]> {
    const rows = await this.db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(eq(artifacts.sourceOrigin, origin))
    return rows.map((row) => slug(row.id))
  }

  async listForSnapshot(): Promise<readonly Artifact[]> {
    const rows = await this.db
      .select(listingColumns)
      .from(artifacts)
      .where(eq(artifacts.deprecated, false))
      .orderBy(asc(artifacts.id))
    return rows.map(toListingEntity)
  }

  async catalogStats(): Promise<CatalogStats> {
    const [row] = await this.db
      .select({
        artifactCount: sql<number>`count(*)`,
        // `updated_at` is a `timestamp_ms` column, so inside a raw aggregate it
        // is the stored integer milliseconds, not a Date.
        maxUpdatedAtMs: sql<number>`coalesce(max(${artifacts.updatedAt}), 0)`,
        installs: sql<number>`coalesce(sum(${artifacts.installs}), 0)`,
        stars: sql<number>`coalesce(sum(${artifacts.stars}), 0)`,
        downloads: sql<number>`coalesce(sum(${artifacts.downloads}), 0)`,
      })
      .from(artifacts)
      .where(eq(artifacts.deprecated, false))
    return {
      artifactCount: Number(row?.artifactCount ?? 0),
      maxUpdatedAtMs: Number(row?.maxUpdatedAtMs ?? 0),
      installs: Number(row?.installs ?? 0),
      stars: Number(row?.stars ?? 0),
      downloads: Number(row?.downloads ?? 0),
    }
  }

  private async writeStatements(artifact: Artifact): Promise<BatchStatement[]> {
    const props = artifact.toProps()
    const summaryHash = await readmeDigest(props.summary)
    const readmeHash =
      props.readmeMarkdown === undefined ? null : await readmeDigest(props.readmeMarkdown)
    const topics = inferTopics({
      keywords: props.keywords,
      text: [props.displayName, props.summary, props.readmeMarkdown ?? ''].join(' '),
    })
    const values = {
      id: props.id as string,
      kind: props.kind,
      displayName: props.displayName,
      summary: props.summary,
      summaryHash,
      readmeHash,
      source: props.source,
      sourceOrigin: props.source.origin,
      sourceCommitSha: props.sourceCommitSha ?? null,
      payload: props.payload,
      keywords: props.keywords,
      categories: props.categories.map(String),
      license: props.license ?? null,
      authorName: props.author?.name ?? null,
      authorUrl: props.author?.url ?? null,
      readmeMarkdown: props.readmeMarkdown ?? null,
      ogImageUrl: props.ogImageUrl ?? null,
      stars: props.stats.stars,
      downloads: props.stats.downloads,
      installs: props.stats.installs,
      starVelocity7d: props.starVelocity7d,
      starVelocity30d: props.starVelocity30d,
      popularity: artifact.popularity,
      ownerAccountId: props.ownerAccountId ?? null,
      deprecated: props.deprecated,
      publishedAt: props.publishedAt,
      updatedAt: props.updatedAt,
      indexedAt: props.indexedAt,
    }

    const haystack = normalizeSearchText([props.displayName, props.summary, ...props.keywords].join(' '))

    const statements: BatchStatement[] = [
      this.db
        .insert(artifacts)
        .values(values)
        .onConflictDoUpdate({ target: artifacts.id, set: values }),
      this.db.delete(artifactCategories).where(eq(artifactCategories.artifactId, values.id)),
      this.db.delete(artifactTopics).where(eq(artifactTopics.artifactId, values.id)),
      this.db
        .delete(artifactSearchDocuments)
        .where(and(eq(artifactSearchDocuments.artifactId, values.id), sql`${artifactSearchDocuments.locale} != 'und'`)),
      this.db
        .insert(artifactSearch)
        .values({ artifactId: values.id, haystack })
        .onConflictDoUpdate({ target: artifactSearch.artifactId, set: { haystack } }),
      this.db
        .insert(artifactSearchDocuments)
        .values({
          artifactId: values.id,
          locale: 'und',
          displayName: normalizeSearchText(props.displayName),
          summary: normalizeSearchText(props.summary),
          keywords: normalizeSearchText(props.keywords.join(' ')),
          topics: normalizeSearchText(topicSearchText(topics)),
          summaryHash,
          readmeHash,
        })
        .onConflictDoUpdate({
          target: [artifactSearchDocuments.artifactId, artifactSearchDocuments.locale],
          set: {
            displayName: normalizeSearchText(props.displayName),
            summary: normalizeSearchText(props.summary),
            keywords: normalizeSearchText(props.keywords.join(' ')),
            topics: normalizeSearchText(topicSearchText(topics)),
            summaryHash,
            readmeHash,
          },
        }),
    ]

    if (props.categories.length > 0) {
      statements.push(
        this.db.insert(artifactCategories).values(
          props.categories.map((categoryId) => ({
            artifactId: values.id,
            categoryId: String(categoryId),
          })),
        ),
      )
    }

    if (topics.length > 0) {
      statements.push(
        this.db.insert(artifactTopics).values(
          topics.map((topicId) => ({ artifactId: values.id, topicId })),
        ),
      )
    }

    return statements
  }
}

/** FTS5 needs a token of at least three characters; shorter text keeps LIKE. */
export function usesFtsIndex(ftsSearchEnabled: boolean, normalizedQuery: string): boolean {
  return ftsSearchEnabled && normalizedQuery.length >= 3
}

function ftsQuery(normalized: string): string {
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' AND ')
}

function orderFor(query: ArtifactQuery, ftsSearchEnabled: boolean) {
  switch (query.sort) {
    case 'name':
      return [asc(artifacts.displayName), asc(artifacts.id)]
    case 'recent':
      return [desc(artifacts.updatedAt), desc(artifacts.id)]
    case 'rising':
      // Star velocity first, then the stored list rank, so a fast-climbing
      // new plugin outranks a stagnant incumbent.
      return [desc(artifacts.starVelocity7d), desc(artifacts.popularity), desc(artifacts.id)]
    case 'relevance':
      // Ranked by how early the query lands, then by the same weighting
      // `listRank` uses, so a text search still surfaces the artifact people
      // actually install rather than the shortest name.
      return [
        ...(query.text !== undefined && usesFtsIndex(ftsSearchEnabled, normalizeSearchText(query.text))
          ? [
              asc(sql`coalesce((
                select bm25(artifact_search_fts, 8.0, 5.0, 3.0, 2.0)
                from artifact_search_fts
                join artifact_search_documents d on d.rowid = artifact_search_fts.rowid
                where d.artifact_id = ${artifacts.id}
                  and d.locale in (${query.locale ?? 'und'}, 'und')
                  and artifact_search_fts match ${ftsQuery(normalizeSearchText(query.text))}
                limit 1
              ), 999999.0)`),
            ]
          : []),
        desc(sql`(${artifacts.ownerAccountId} is not null)`),
        desc(artifacts.popularity),
        desc(artifacts.id),
      ]
    case 'popular':
    default:
      return [desc(artifacts.popularity), desc(artifacts.updatedAt), desc(artifacts.id)]
  }
}

/**
 * SQL twin of `listRank`. Listing sorts read the stored column; this expression
 * is only for writes that change `installs` without loading the row.
 */
function popularityFromColumns(installs: typeof artifacts.installs | SQL = artifacts.installs) {
  return sql`(
    (${installs} * 3 + ${artifacts.stars} + ${artifacts.downloads} / 10.0)
    * (case when ${artifacts.ownerAccountId} is not null then 1.25 else 1 end)
    * (case when ${artifacts.deprecated} then 0.1 else 1 end)
  )`
}

/** A locale is shown when generated prose is still on the row, including a previous completed body. */
function displayableLocalizedProse() {
  return and(
    sql`nullif(trim(${artifactSummaryTranslations.text}), '') is not null`,
    or(
      sql`${artifacts.readmeHash} is null`,
      sql`nullif(trim(${artifactReadmeTranslations.markdown}), '') is not null`,
    ),
  )
}

/**
 * Card/snapshot projection: payload is small JSON, README is the wide column
 * a listing must not pull. `hasReadme` uses `readme_hash` so SQLite does not
 * visit `readme_markdown` overflow pages to answer a null-check.
 */
const listingColumns = {
  id: artifacts.id,
  kind: artifacts.kind,
  displayName: artifacts.displayName,
  summary: artifacts.summary,
  summaryHash: artifacts.summaryHash,
  readmeHash: artifacts.readmeHash,
  source: artifacts.source,
  sourceOrigin: artifacts.sourceOrigin,
  sourceCommitSha: artifacts.sourceCommitSha,
  payload: artifacts.payload,
  keywords: artifacts.keywords,
  categories: artifacts.categories,
  license: artifacts.license,
  authorName: artifacts.authorName,
  authorUrl: artifacts.authorUrl,
  ogImageUrl: artifacts.ogImageUrl,
  stars: artifacts.stars,
  downloads: artifacts.downloads,
  installs: artifacts.installs,
  starVelocity7d: artifacts.starVelocity7d,
  starVelocity30d: artifacts.starVelocity30d,
  popularity: artifacts.popularity,
  ownerAccountId: artifacts.ownerAccountId,
  deprecated: artifacts.deprecated,
  publishedAt: artifacts.publishedAt,
  updatedAt: artifacts.updatedAt,
  indexedAt: artifacts.indexedAt,
  hasReadme: sql<number>`(${artifacts.readmeHash} is not null)`.as('has_readme'),
}

function toListingEntity(row: Omit<ArtifactRow, 'readmeMarkdown'> & { hasReadme: number }): Artifact {
  const { hasReadme, ...rest } = row
  return toEntity({
    ...rest,
    readmeMarkdown: Number(hasReadme) === 0 ? null : '#',
  })
}

function toEntity(row: ArtifactRow): Artifact {
  const props: ArtifactProps = {
    id: slug(row.id),
    kind: artifactKind(row.kind),
    displayName: row.displayName,
    summary: row.summary,
    source: row.source as SourceRef,
    ...(row.sourceCommitSha === null ? {} : { sourceCommitSha: row.sourceCommitSha }),
    payload: row.payload as ArtifactPayload,
    keywords: (row.keywords as string[]) ?? [],
    categories: ((row.categories as string[]) ?? []).map((value) => slug(value)),
    ...(row.license === null ? {} : { license: row.license }),
    ...(row.authorName === null
      ? {}
      : { author: { name: row.authorName, ...(row.authorUrl === null ? {} : { url: row.authorUrl }) } }),
    ...(row.readmeMarkdown === null ? {} : { readmeMarkdown: row.readmeMarkdown }),
    ...(row.ogImageUrl === null ? {} : { ogImageUrl: row.ogImageUrl }),
    stats: { stars: row.stars, downloads: row.downloads, installs: row.installs },
    starVelocity7d: row.starVelocity7d,
    starVelocity30d: row.starVelocity30d,
    ...(row.ownerAccountId === null ? {} : { ownerAccountId: row.ownerAccountId }),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    indexedAt: row.indexedAt,
    deprecated: row.deprecated,
  }
  return Artifact.rehydrate(props)
}
