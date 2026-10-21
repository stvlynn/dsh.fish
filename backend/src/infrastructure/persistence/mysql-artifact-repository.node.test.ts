import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { z } from 'zod'
import { createPool, type Pool } from 'mysql2/promise'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import { Review } from '../../domain/review/review.js'
import { Submission } from '../../domain/submission/submission.js'
import { readmeDigest } from '../../application/lib/readme-digest.js'
import { MysqlArtifactRepository } from './mysql-artifact-repository.js'
import { MysqlReadmeTranslationRepository } from './mysql-readme-translation-repository.js'
import { MysqlSummaryTranslationRepository } from './mysql-summary-translation-repository.js'
import { MysqlReadmeTranslationChunkRepository } from './mysql-readme-translation-chunk-repository.js'
import { MysqlReviewRepository } from './mysql-review-repository.js'
import { MysqlSubmissionRepository } from './mysql-submission-repository.js'
import * as schema from './mysql-schema.js'

// Opt-in only: the test process reads the explicitly supplied validation config.
// The database is fixed, TLS is mandatory, and credentials are never logged.
const testConfigPath = process.env.MYSQL_TEST_CONFIG
const testSchema = 'dsh_fish_validation'
const validationConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  user: z.string().min(1),
  password: z.string(),
  ca: z.string().min(1),
  tls_server_name: z.string().min(1),
})

describe.skipIf(testConfigPath === undefined)(
  'MySQL repositories on an isolated migrated schema',
  () => {
    let pool: Pool
    let db: MySql2Database<typeof schema>
    let repository: MysqlArtifactRepository
    let current: Artifact
    let submissionId: string

    beforeAll(async () => {
      const parsed = validationConfig.safeParse(JSON.parse(readFileSync(testConfigPath!, 'utf8')))
      if (!parsed.success) throw new Error('Invalid MySQL validation configuration')
      const config = parsed.data
      pool = createPool({
        host: config.tls_server_name,
        port: config.port,
        user: config.user,
        password: config.password,
        database: testSchema,
        connectionLimit: 3,
        stream: () => createConnection({ host: config.host, port: config.port }),
        ssl: {
          ca: readFileSync(config.ca, 'utf8'),
          rejectUnauthorized: true,
          verifyIdentity: true,
        },
      })
      db = drizzle(pool, { schema, mode: 'default' })
      const [rows] = await pool.query('select database() as schema_name')
      expect(rows).toEqual([{ schema_name: testSchema }])
      repository = new MysqlArtifactRepository(db)
    })

    beforeEach(async () => {
      const id = 'mysql-test-' + randomUUID()
      submissionId = id + '-submission'
      current = Artifact.create({
        id,
        kind: 'bundle',
        displayName: 'Test browser bundle',
        summary: 'Browser integration tooling',
        source: npmSource(id, '1.0.0'),
        payload: { kind: 'bundle', requiresBuild: false },
        keywords: ['browser'],
        categories: ['dev'],
        readmeMarkdown: '# Browser integration',
        stats: { stars: 100, downloads: 20, installs: 3 },
      })
      await repository.save(current)
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      vi.useRealTimers()
      if (current) {
        // Delete only this test's rows; artifacts cascades related projections and translations.
        await db
          .delete(schema.artifactSearch)
          .where(eq(schema.artifactSearch.artifactId, current.id))
        await db.delete(schema.artifacts).where(eq(schema.artifacts.id, current.id))
        await db.delete(schema.submissions).where(eq(schema.submissions.id, submissionId))
      }
    })
    afterAll(async () => {
      if (pool) await pool.end()
    })

    it('round-trips catalog data, computes install rank once, and serves sitemap entries', async () => {
      expect((await repository.findById(current.id))?.toProps()).toMatchObject(current.toProps())
      await repository.incrementInstalls(current.id, 2)
      const stored = await repository.findById(current.id)
      expect(stored?.stats.installs).toBe(5)
      const [rank] = await db
        .select({ popularity: schema.artifacts.popularity })
        .from(schema.artifacts)
        .where(eq(schema.artifacts.id, current.id))
      expect(rank?.popularity).toBe(5 * 3 + 100 + 20 / 10)
      const sitemap = await repository.listForSitemap({ limit: 1000, offset: 0 })
      expect(sitemap.items.some((entry) => entry.id === current.id)).toBe(true)
      const matches = await repository.search({
        text: String(current.id),
        locale: 'ja',
        sort: 'relevance',
        page: { limit: 10, offset: 0 },
      })
      expect(matches.items.some((item) => item.id === current.id)).toBe(true)
    })

    it('retains previous generated prose across source updates and invalidates only search documents', async () => {
      const readmes = new MysqlReadmeTranslationRepository(db)
      const summaries = new MysqlSummaryTranslationRepository(db)
      const base = {
        artifactId: current.id,
        locale: 'ja',
        sourceHash: 'old-hash',
        status: 'completed' as const,
        updatedAt: new Date(),
      }
      await readmes.save({ ...base, markdown: '# Previous localized body' })
      await summaries.save({ ...base, text: 'Previous localized summary' })
      await repository.refreshLocalizedSearchDocument(current.id, 'ja')
      await readmes.save({ ...base, sourceHash: 'new-hash', status: 'pending' })
      await summaries.save({ ...base, sourceHash: 'new-hash', status: 'pending' })
      const changed = current.refreshedWith({
        displayName: 'Renamed browser bundle',
        summary: 'Changed browser source',
        source: current.source,
        payload: current.payload,
        keywords: current.keywords,
        categories: ['dev'],
        stats: current.stats,
        readmeMarkdown: '# Changed source body',
      })
      await repository.save(changed)
      expect((await readmes.find(current.id, 'ja'))?.markdown).toBe('# Previous localized body')
      expect((await summaries.find(current.id, 'ja'))?.text).toBe('Previous localized summary')
      expect(
        (await repository.listAvailableLocales(current.id)).map((entry) => entry.locale),
      ).toContain('ja')
      const localized = () =>
        db
          .select()
          .from(schema.artifactSearchDocuments)
          .where(
            and(
              eq(schema.artifactSearchDocuments.artifactId, current.id),
              eq(schema.artifactSearchDocuments.locale, 'ja'),
            ),
          )
      expect(await localized()).toEqual([])
      await repository.refreshLocalizedSearchDocument(current.id, 'ja')
      // An existing document must update these fields, not just its summary.
      await db
        .update(schema.artifactSearchDocuments)
        .set({ displayName: 'stale', summaryHash: 'stale', readmeHash: 'stale' })
        .where(
          and(
            eq(schema.artifactSearchDocuments.artifactId, current.id),
            eq(schema.artifactSearchDocuments.locale, 'ja'),
          ),
        )
      await repository.refreshLocalizedSearchDocument(current.id, 'ja')
      expect((await localized())[0]).toMatchObject({
        displayName: 'renamed browser bundle',
        summary: 'previous localized summary',
        summaryHash: await readmeDigest(changed.summary),
        readmeHash: await readmeDigest('# Changed source body'),
      })
      await readmes.save({ ...base, status: 'pending' }, { retainPreviousBody: false })
      await summaries.save({ ...base, status: 'pending' }, { retainPreviousBody: false })
      expect((await readmes.find(current.id, 'ja'))?.markdown).toBeUndefined()
      expect((await summaries.find(current.id, 'ja'))?.text).toBeUndefined()
      await repository.refreshLocalizedSearchDocument(current.id, 'ja')
      expect(await localized()).toEqual([])
    })

    it('round-trips submission decisions and preserves the first review creation timestamp', async () => {
      const submissions = new MysqlSubmissionRepository(db)
      const pending = Submission.open({
        id: submissionId,
        accountId: 'test-owner',
        kind: current.kind,
        source: current.source,
        note: 'Review source',
      })
      await submissions.save(pending)
      expect((await submissions.findPendingBySource(current.source))?.id).toBe(submissionId)
      await submissions.save(pending.approve(String(current.id)))
      expect((await submissions.findById(submissionId))?.toProps()).toMatchObject({
        status: 'approved',
        artifactId: current.id,
      })
      expect(await submissions.findPendingBySource(current.source)).toBeUndefined()
      const reviews = new MysqlReviewRepository(db)
      const createdAt = new Date('2025-01-01T00:00:00Z')
      await reviews.save(
        Review.rehydrate({
          artifactId: String(current.id),
          accountId: 'test-reviewer',
          authorName: 'Original',
          rating: 2,
          comment: 'Original wording',
          createdAt,
          updatedAt: createdAt,
        }),
      )
      await reviews.save(
        Review.rate({
          artifactId: String(current.id),
          accountId: 'test-reviewer',
          authorName: 'Renamed',
          rating: 5,
        }),
      )
      expect((await reviews.listByArtifact(String(current.id), 10))[0]?.toProps()).toMatchObject({
        authorName: 'Renamed',
        rating: 5,
        createdAt,
      })
      expect((await reviews.listByArtifact(String(current.id), 10))[0]?.comment).toBeUndefined()
      expect(await reviews.summarize(String(current.id))).toEqual({
        average: 5,
        count: 1,
        distribution: [0, 0, 0, 0, 1],
      })
    })

    it('resumes only current-hash chunks and overwrites non-key fields', async () => {
      const chunks = new MysqlReadmeTranslationChunkRepository(db)
      const input = {
        artifactId: current.id,
        locale: 'ja',
        sourceHash: 'old-hash',
        chunkIndex: 0,
        chunkCount: 2,
        text: 'Old',
      }
      await chunks.save(input)
      expect(await chunks.prepare(current.id, 'ja', 'new-hash')).toEqual(new Set())
      await chunks.save({ ...input, sourceHash: 'new-hash', text: 'A' })
      await chunks.save({ ...input, sourceHash: 'new-hash', text: 'Updated ' })
      expect(await chunks.assemble(current.id, 'ja', 'new-hash', 2)).toBeUndefined()
      await chunks.save({ ...input, sourceHash: 'new-hash', chunkIndex: 1, text: 'B' })
      expect(await chunks.assemble(current.id, 'ja', 'new-hash', 2)).toBe('Updated B')
      await chunks.clear(current.id, 'ja', 'new-hash')
      expect(await chunks.prepare(current.id, 'ja', 'new-hash')).toEqual(new Set())
    })

    it('round-trips NULL, JSON, epoch dates and NUL bytes and finds English and Chinese prose', async () => {
      const changed = current.refreshedWith({
        displayName: 'Browser 中文工具',
        summary: 'Browser tools 中文浏览器自动化工具',
        source: current.source,
        payload: current.payload,
        keywords: ['browser', '中文', 'nul\0keyword'],
        categories: ['dev'],
        stats: current.stats,
        readmeMarkdown: '# README\0body',
      })
      await repository.save(changed)
      const stored = await repository.findById(current.id)
      expect(stored?.readmeMarkdown).toBe('# README\0body')
      expect(stored?.keywords).toContain('nul\0keyword')
      expect(stored?.source).toEqual(changed.source)
      expect(stored?.payload).toEqual(changed.payload)
      expect(stored?.updatedAt.getTime()).toBe(changed.updatedAt.getTime())
      const [row] = await db
        .select()
        .from(schema.artifacts)
        .where(eq(schema.artifacts.id, current.id))
      expect(row?.ownerAccountId).toBeNull()
      expect(row?.authorUrl).toBeNull()
      for (const text of ['browser', '浏览器']) {
        const matches = await repository.search({
          text,
          locale: 'zh-CN',
          sort: 'relevance',
          page: { limit: 100, offset: 0 },
        })
        expect(matches.items.some((item) => item.id === current.id)).toBe(true)
      }
    })

    it('serializes concurrent install increments without losing counters or rank', async () => {
      await Promise.all([
        repository.incrementInstalls(current.id, 2),
        repository.incrementInstalls(current.id, 4),
      ])
      const [row] = await db
        .select()
        .from(schema.artifacts)
        .where(eq(schema.artifacts.id, current.id))
      expect(row?.installs).toBe(9)
      expect(row?.popularity).toBe(9 * 3 + 100 + 20 / 10)
    })

    it('handles duplicate concurrent metrics and rolls back a snapshot when the counter write fails', async () => {
      vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date('2025-02-01T00:00:00Z'))
      await Promise.all([
        repository.recordMetricsSnapshot(current),
        repository.recordMetricsSnapshot(current),
      ])
      const count = async () =>
        (
          await db
            .select({ total: sql<number>`count(*)` })
            .from(schema.artifactMetrics)
            .where(eq(schema.artifactMetrics.artifactId, current.id))
        )[0]?.total
      expect(Number(await count())).toBe(1)
      vi.setSystemTime(new Date('2025-02-02T00:00:00Z'))
      const transaction = db.transaction.bind(db)
      vi.spyOn(db, 'transaction').mockImplementation((callback) =>
        transaction(async (tx) => {
          vi.spyOn(tx, 'update').mockImplementation(() => {
            throw new Error('Injected counter failure')
          })
          return callback(tx)
        }),
      )
      await expect(repository.recordMetricsSnapshot(current)).rejects.toThrow(
        'Injected counter failure',
      )
      expect(Number(await count())).toBe(1)
    })
  },
)
