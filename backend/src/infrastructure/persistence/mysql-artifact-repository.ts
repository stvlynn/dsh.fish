import { projectArtifact } from './artifact-projection.js'
import { toEntity, toListingEntity } from './artifact-row.js'
import { and, asc, desc, eq, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { Artifact } from '../../domain/artifact/artifact.js'
import { artifactKind } from '../../domain/artifact/artifact-kind.js'
import type {
  ArtifactQuery,
  ArtifactRepository,
  CatalogStats,
  FacetCounts,
  SitemapEntry,
} from '../../domain/artifact/artifact-repository.js'
import { inferTopics, normalizeSearchText, topicSearchText } from '../../domain/artifact/topic.js'
import { starVelocity } from '../../domain/artifact/quality-score.js'
import type { MetricsSnapshot } from '../../domain/artifact/quality-score.js'
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
  catalogFacetCounts,
} from './mysql-schema.js'
import * as schema from './mysql-schema.js'

type Db = MySql2Database<typeof schema>
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * MySQL implementation of the catalog port.
 *
 * D1 has no server-side transactions across statements, so multi-table writes
 * go through `db.batch`, which D1 does apply atomically. That matters for the
 * artifact + categories + search-index triple: a half-applied write would leave
 * a row that browses but never appears in search.
 */
export class MysqlArtifactRepository implements ArtifactRepository {
  constructor(
    private readonly db: Db,
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
    const matches = query.text === undefined ? undefined : searchMatches(query.text, query.locale ?? 'und')
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
    const order = orderFor(query)
    const [countRows, pageRows] = await this.db.transaction(async (tx) => {
      let countQuery = tx.select({ total: sql<number>`count(*)` }).from(artifacts).$dynamic()
      let pageQuery = tx.select(listingColumns).from(artifacts).$dynamic()
      if (matches !== undefined) {
        const join = sql`catalog_matches.artifact_id = ${artifacts.id}`
        countQuery = countQuery.innerJoin(matches, join)
        pageQuery = pageQuery.innerJoin(matches, join)
      }
      return [
        await countQuery.where(where),
        await pageQuery.where(where).orderBy(...order).limit(query.page.limit).offset(query.page.offset),
      ] as const
    })

    return page(pageRows.map(toListingEntity), Number(countRows[0]?.total ?? 0), query.page)
  }

  async readFacetCounts(): Promise<FacetCounts | undefined> {
    const rows = await this.db.select().from(catalogFacetCounts)
    // The `meta` row is written by every refresh, so its absence means the
    // table was never populated — distinct from a live catalog with no topics.
    const meta = rows.find((row) => row.dimension === 'meta')
    if (meta === undefined) return undefined

    const inDimension = (dimension: string) =>
      rows.filter((row) => row.dimension === dimension).map((row) => ({ id: row.facetId, count: row.count }))
    return {
      kinds: inDimension('kind').map((entry) => ({ kind: artifactKind(entry.id), count: entry.count })),
      categories: inDimension('category'),
      topics: inDimension('topic'),
      refreshedAt: meta.refreshedAt,
    }
  }

  async refreshFacetCounts(): Promise<void> {
    const now = Math.trunc(Date.now())
    await this.db.transaction(async (tx) => {
      await tx.delete(catalogFacetCounts)
      await tx.execute(sql`insert into catalog_facet_counts (dimension, facet_id, count, refreshed_at)
        select 'kind', kind, count(*), ${now} from artifacts where deprecated = 0 group by kind`)
      await tx.execute(sql`insert into catalog_facet_counts (dimension, facet_id, count, refreshed_at)
        select 'category', c.category_id, count(*), ${now} from artifact_categories c
        join artifacts a on a.id=c.artifact_id where a.deprecated=0 group by c.category_id`)
      await tx.execute(sql`insert into catalog_facet_counts (dimension, facet_id, count, refreshed_at)
        select 'topic', t.topic_id, count(*), ${now} from artifact_topics t
        join artifacts a on a.id=t.artifact_id where a.deprecated=0 group by t.topic_id`)
      await tx.execute(sql`insert into catalog_facet_counts (dimension, facet_id, count, refreshed_at)
        select 'meta', 'live', count(*), ${now} from artifacts where deprecated=0`)
    })
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
    const readmeMarkdown =
      props.readmeMarkdown?.trim() === '' ? undefined : props.readmeMarkdown
    const topics = inferTopics({
      keywords: props.keywords,
      text: [props.displayName, props.summary, readmeMarkdown ?? ''].join(' '),
    })
    const document = {
      artifactId: String(id),
      locale,
      displayName: normalizeSearchText(props.displayName),
      summary: normalizeSearchText(summaryRow.text),
      keywords: normalizeSearchText(props.keywords.join(' ')),
      topics: normalizeSearchText(topicSearchText(topics)),
      summaryHash: await readmeDigest(props.summary),
      readmeHash: readmeMarkdown === undefined ? null : await readmeDigest(readmeMarkdown),
    }
    await this.db
      .insert(artifactSearchDocuments)
      .values(document)
      .onDuplicateKeyUpdate({ set: document })
  }

  async refreshSearchMetadata(id: Slug): Promise<void> {
    const artifact = await this.findById(id)
    if (artifact) await this.save(artifact)
  }

  async save(artifact: Artifact): Promise<void> {
    const { props, values, topics, haystack, summaryHash, readmeHash } = await projectArtifact(artifact)
    const document = {
      artifactId: values.id, locale: 'und',
      displayName: normalizeSearchText(props.displayName),
      summary: normalizeSearchText(props.summary),
      keywords: normalizeSearchText(props.keywords.join(' ')),
      topics: normalizeSearchText(topicSearchText(topics)), summaryHash, readmeHash,
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(artifacts).values(values).onDuplicateKeyUpdate({ set: values })
      await tx.delete(artifactCategories).where(eq(artifactCategories.artifactId, values.id))
      await tx.delete(artifactTopics).where(eq(artifactTopics.artifactId, values.id))
      // Match D1: invalidate localized search projections, never the retained translation bodies.
      await tx.delete(artifactSearchDocuments).where(and(eq(artifactSearchDocuments.artifactId, values.id), sql`${artifactSearchDocuments.locale} != 'und'`))
      await tx.insert(artifactSearch).values({ artifactId: values.id, haystack }).onDuplicateKeyUpdate({ set: { haystack } })
      await tx.insert(artifactSearchDocuments).values(document).onDuplicateKeyUpdate({ set: document })
      if (props.categories.length) await tx.insert(artifactCategories).values(props.categories.map((categoryId) => ({ artifactId: values.id, categoryId: String(categoryId) })))
      if (topics.length) await tx.insert(artifactTopics).values(topics.map((topicId) => ({ artifactId: values.id, topicId })))
    })
  }

  async saveMany(list: readonly Artifact[]): Promise<void> {
    // One artifact transaction at a time bounds write concurrency on the origin.
    for (const artifact of list) await this.save(artifact)
  }

  async incrementInstalls(id: Slug, by: number): Promise<void> {
    // MySQL evaluates SET left to right; Drizzle orders builder assignments by
    // schema columns, so explicit SQL keeps rank ahead of the install increment.
    await this.db.execute(sql`update ${artifacts}
      set ${sql.identifier(artifacts.popularity.name)} = ${popularityFromColumns(sql`${artifacts.installs} + ${by}`)},
          ${sql.identifier(artifacts.installs.name)} = ${artifacts.installs} + ${by}
      where ${artifacts.id} = ${id}`)
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

    await this.db.transaction(async (tx) => {
      await tx
        .insert(artifactMetrics)
        .values({
          artifactId: props.id as string,
          stars: props.stats.stars,
          downloads: props.stats.downloads,
          installs: props.stats.installs,
          capturedAt: now,
        })
        // Two sweeps inside the same millisecond must not fail the second one.
        .onDuplicateKeyUpdate({ set: { capturedAt: sql`${artifactMetrics.capturedAt}` } })
      await tx
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
    })
  }

  async listForSitemap(request: PageRequest): Promise<Page<SitemapEntry>> {
    // A deprecated artifact still resolves and is still linked from the pages
    // that reference it, but it is not something to invite a crawler to.
    const where = eq(artifacts.deprecated, false)

    const [countRows, pageRows] = await this.db.transaction(async (tx) => {
      const countQuery = tx
        .select({ total: sql<number>`count(*)` })
        .from(artifacts)
        .where(where)
      const pageQuery = tx
        .select({ id: artifacts.id, updatedAt: artifacts.updatedAt })
        .from(artifacts)
        .where(where)
        .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
        .limit(request.limit)
        .offset(request.offset)
      return [await countQuery, await pageQuery] as const
    })

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
                inArray(artifactSummaryTranslations.artifactId, ids),
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

}

/** FTS produces a bounded candidate set before catalog filtering and ranking. */
function searchMatches(text: string, locale: string): SQL {
  const normalized = normalizeSearchText(text)
  const needle = `%${normalized}%`
  const tokens = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const expression = tokens.map((token) => `+"${token}"`).join(' ')
  if (normalized.length < 2 || expression === '') {
    return sql`(select distinct artifact_id, 0.0 as score from artifact_search_documents
      where locale in (${locale}, 'und') and
      (artifact_id like ${needle} or display_name like ${needle} or summary like ${needle}
       or keywords like ${needle} or topics like ${needle})) as catalog_matches`
  }
  return sql`(select artifact_id, max(score) as score from (
    select artifact_id, match(display_name,summary,keywords,topics) against (${expression} in boolean mode) as score
    from artifact_search_documents where locale in (${locale}, 'und')
      and match(display_name,summary,keywords,topics) against (${expression} in boolean mode)
    union all
    select artifact_id, 0.0 as score from artifact_search_documents
      where locale in (${locale}, 'und') and artifact_id like ${needle}
    ) candidates group by artifact_id) as catalog_matches`
}

function orderFor(query: ArtifactQuery) {
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
      return [
        ...(query.text === undefined ? [] : [desc(sql`catalog_matches.score`)]),
        desc(sql`(${artifacts.ownerAccountId} is not null)`),
        desc(artifacts.popularity), desc(artifacts.id),
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
    ((${installs}) * 3 + ${artifacts.stars} + ${artifacts.downloads} / 10.0)
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
