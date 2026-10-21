import { getTableColumns } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import { slug } from '../../domain/shared/slug.js'
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

type QueryCall = { connection: 'pool' | 'transaction'; sql: string; params: unknown[] }

/** Run real Drizzle SQL builders against distinct pool and transaction driver mocks. */
function database(
  rows: (call: QueryCall) => unknown[][] = () => [],
  fail?: (call: QueryCall) => boolean,
) {
  const calls: QueryCall[] = []
  const query =
    (connection: QueryCall['connection']) => async (input: { sql: string }, params: unknown[]) => {
      const call = { connection, sql: input.sql, params }
      calls.push(call)
      if (fail?.(call)) throw new Error('Injected query failure')
      return [input.sql.startsWith('select') ? rows(call) : { affectedRows: 1, insertId: 1 }, []]
    }
  const release = vi.fn()
  const pool = {
    query: query('pool'),
    getConnection: async () => ({ query: query('transaction'), release }),
  }
  return { db: drizzle(pool as never, { schema, mode: 'default' }), calls, release }
}

function artifact() {
  return Artifact.create({
    id: 'test-bundle',
    kind: 'bundle',
    displayName: 'Test Bundle',
    summary: 'Browser tools',
    source: npmSource('test-bundle', '1.0.0'),
    payload: { kind: 'bundle', requiresBuild: false },
    keywords: ['browser'],
    categories: ['dev'],
    readmeMarkdown: '# Browser',
    stats: { stars: 100, downloads: 20, installs: 3 },
  })
}

function updateClause(call: QueryCall) {
  return call.sql.split(' on duplicate key update ')[1] ?? ''
}

function updatedColumns(call: QueryCall) {
  return [...updateClause(call).matchAll(/`([^`]+)`\s*=/g)].map((match) => match[1])
}

afterEach(() => vi.useRealTimers())

describe('MySQL artifact repository SQL and transaction ownership', () => {
  it('executes metrics writes on the transaction connection, not the pool', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2025-02-01T00:00:00Z'))
    const mock = database((call) =>
      call.sql.includes('artifact_metrics') ? [[60, Date.parse('2025-01-01T00:00:00Z')]] : [],
    )
    await new MysqlArtifactRepository(mock.db).recordMetricsSnapshot(artifact())
    expect(mock.calls.map(({ connection, sql }) => [connection, sql.split(' ')[0]])).toEqual([
      ['pool', 'select'],
      ['pool', 'select'],
      ['transaction', 'begin'],
      ['transaction', 'insert'],
      ['transaction', 'update'],
      ['transaction', 'commit'],
    ])
    const update = mock.calls.find((call) => call.sql.startsWith('update'))!
    expect(update.params.slice(0, 4)).toEqual([100, 20, 40, 40])
    expect(updatedColumns(mock.calls.find((call) => call.sql.startsWith('insert'))!)).toEqual([
      'captured_at',
    ])
    expect(mock.release).toHaveBeenCalledOnce()
  })

  it('rolls back metrics when the second write fails and does not commit', async () => {
    const mock = database(undefined, (call) => call.sql.startsWith('update'))
    await expect(
      new MysqlArtifactRepository(mock.db).recordMetricsSnapshot(artifact()),
    ).rejects.toThrow()
    expect(mock.calls.at(-1)).toMatchObject({ connection: 'transaction', sql: 'rollback' })
    expect(mock.calls.some((call) => call.sql === 'commit')).toBe(false)
    expect(mock.release).toHaveBeenCalledOnce()
  })

  it('builds sitemap count and page on the transaction connection', async () => {
    const updatedAt = Date.parse('2025-01-01T00:00:00Z')
    const mock = database((call) => {
      if (call.sql.includes('count(*)')) return [['1']]
      if (call.sql.includes('from `artifacts`')) return [['test-bundle', updatedAt]]
      return [['test-bundle', 'ja', updatedAt + 1, updatedAt + 2]]
    })
    const result = await new MysqlArtifactRepository(mock.db).listForSitemap({
      limit: 1000,
      offset: 0,
    })
    expect(mock.calls.slice(0, 4).map((call) => call.connection)).toEqual(
      Array(4).fill('transaction'),
    )
    expect(mock.calls.slice(0, 4).map((call) => call.sql.split(' ')[0])).toEqual([
      'begin',
      'select',
      'select',
      'commit',
    ])
    expect(result.total).toBe(1)
    expect(result.items[0]?.locales).toEqual([{ locale: 'ja', updatedAt: new Date(updatedAt + 2) }])
    expect(mock.calls[2]?.params).toEqual([false, 1000])
  })

  it('does not issue a locale query for an empty sitemap page', async () => {
    const mock = database((call) => (call.sql.includes('count(*)') ? [[0]] : []))
    expect(
      (await new MysqlArtifactRepository(mock.db).listForSitemap({ limit: 10, offset: 0 })).items,
    ).toEqual([])
    expect(mock.calls).toHaveLength(4)
  })

  it('search count and listing share a transaction and bounded locale-aware candidates', async () => {
    const mock = database((call) => (call.sql.includes('count(*)') ? [[0]] : []))
    await new MysqlArtifactRepository(mock.db).search({
      text: 'browser',
      locale: 'ja',
      sort: 'relevance',
      page: { limit: 10, offset: 20 },
    })
    const selects = mock.calls.filter((call) => call.sql.startsWith('select'))
    expect(selects).toHaveLength(2)
    for (const call of selects) {
      expect(call.connection).toBe('transaction')
      expect(call.sql).toContain('match(display_name,summary,keywords,topics)')
      expect(call.params).toContain('ja')
      expect(call.params).toContain('+' + '"browser"')
    }
    expect(selects[1]?.params.slice(-2)).toEqual([10, 20])
  })

  it('matches D1 save invalidation without deleting retained translation bodies', async () => {
    const mock = database()
    await new MysqlArtifactRepository(mock.db).save(artifact())
    const deletes = mock.calls.filter((call) => call.sql.startsWith('delete'))
    expect(deletes.map((call) => call.sql.split(' ')[2])).toEqual([
      '`artifact_categories`',
      '`artifact_topics`',
      '`artifact_search_documents`',
    ])
    expect(deletes[2]?.sql).toContain("`artifact_search_documents`.`locale` != 'und'")
    expect(deletes.every((call) => call.params[0] === 'test-bundle')).toBe(true)
    expect(mock.calls.every((call) => call.connection === 'transaction')).toBe(true)
    const inserts = mock.calls.filter((call) => call.sql.startsWith('insert'))
    const catalog = inserts.find((call) => call.sql.includes('into `artifacts`'))!
    expect(updatedColumns(catalog)).toEqual(
      Object.values(getTableColumns(schema.artifacts)).map((column) => column.name),
    )
    const doc = inserts.find((call) => call.sql.includes('into `artifact_search_documents`'))!
    expect(updatedColumns(doc)).toEqual([
      'artifact_id',
      'locale',
      'display_name',
      'summary',
      'keywords',
      'topics',
      'summary_hash',
      'readme_hash',
    ])
  })

  it('updates every localized document field, including renamed displayName and current hashes', async () => {
    const mock = database(() => [['Localized browser tools']])
    const repository = new MysqlArtifactRepository(mock.db)
    vi.spyOn(repository, 'findById').mockResolvedValue(artifact())
    vi.spyOn(repository, 'listAvailableLocales').mockResolvedValue([
      { locale: 'ja', updatedAt: new Date() },
    ])
    await repository.refreshLocalizedSearchDocument(slug('test-bundle'), 'ja')
    const insert = mock.calls.find((call) => call.sql.startsWith('insert'))!
    expect(updatedColumns(insert)).toEqual([
      'artifact_id',
      'locale',
      'display_name',
      'summary',
      'keywords',
      'topics',
      'summary_hash',
      'readme_hash',
    ])
    expect(insert.params.slice(-8)).toEqual(insert.params.slice(0, 8))
    expect(insert.params).toContain(await readmeDigest('Browser tools'))
    expect(insert.params).toContain(await readmeDigest('# Browser'))
    expect(insert.params).toContain('test bundle')
  })

  it('removes only the requested locale document when generated prose is unavailable', async () => {
    const mock = database()
    const repository = new MysqlArtifactRepository(mock.db)
    vi.spyOn(repository, 'findById').mockResolvedValue(artifact())
    vi.spyOn(repository, 'listAvailableLocales').mockResolvedValue([])
    await repository.refreshLocalizedSearchDocument(slug('test-bundle'), 'ja')
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]?.sql).toContain('delete from `artifact_search_documents`')
    expect(mock.calls[0]?.params).toEqual(['test-bundle', 'ja'])
  })

  it('increments installs after computing popularity from the pre-update columns', async () => {
    const mock = database()
    await new MysqlArtifactRepository(mock.db).incrementInstalls(slug('test-bundle'), 2)
    const call = mock.calls[0]!
    expect(call.sql.indexOf('`popularity` =')).toBeLessThan(call.sql.indexOf('`installs` ='))
    expect(call.params).toEqual([2, 2, 'test-bundle'])
    expect(call.sql).toContain('(`artifacts`.`installs` + ?) * 3')
  })
})

describe('MySQL related repository duplicate-update contracts', () => {
  const translation = {
    artifactId: slug('test-bundle'),
    locale: 'ja',
    sourceHash: 'new-hash',
    status: 'pending' as const,
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  }

  it.each(['readme', 'summary'] as const)(
    'retains previous %s body while replacing metadata by default',
    async (kind) => {
      const mock = database()
      const repository =
        kind === 'readme'
          ? new MysqlReadmeTranslationRepository(mock.db)
          : new MysqlSummaryTranslationRepository(mock.db)
      await repository.save(translation)
      const call = mock.calls[0]!
      const body = kind === 'readme' ? 'markdown' : 'text'
      expect(updatedColumns(call)).toEqual([
        'artifact_id',
        'locale',
        'source_hash',
        'status',
        body,
        'error',
        'updated_at',
      ])
      expect(updateClause(call)).toContain('coalesce(values(' + body + '), ')
      expect(call.params).toContain('new-hash')
      expect(call.params).toContain('pending')
    },
  )

  it.each(['readme', 'summary'] as const)(
    'can explicitly clear the previous %s body',
    async (kind) => {
      const mock = database()
      const repository =
        kind === 'readme'
          ? new MysqlReadmeTranslationRepository(mock.db)
          : new MysqlSummaryTranslationRepository(mock.db)
      await repository.save(translation, { retainPreviousBody: false })
      expect(updateClause(mock.calls[0]!)).not.toContain('coalesce')
      expect(mock.calls[0]?.params.filter((value) => value === null)).toHaveLength(4)
    },
  )

  it('review duplicate updates replace public fields but preserve original createdAt', async () => {
    const mock = database()
    await new MysqlReviewRepository(mock.db).save(
      Review.rate({
        artifactId: 'test-bundle',
        accountId: 'reviewer',
        authorName: 'Renamed',
        rating: 4,
      }),
    )
    expect(updatedColumns(mock.calls[0]!)).toEqual([
      'author_name',
      'author_avatar_url',
      'rating',
      'comment',
      'updated_at',
    ])
    expect(updateClause(mock.calls[0]!)).not.toContain('created_at')
    expect(mock.calls[0]?.params).toContain(null)
  })

  it('submission duplicate updates cover the entire projection including decision and source key', async () => {
    const mock = database()
    const submission = Submission.open({
      id: 'submission-1',
      accountId: 'owner',
      kind: 'bundle',
      source: npmSource('test-bundle', '1.0.0'),
    }).approve('test-bundle')
    await new MysqlSubmissionRepository(mock.db).save(submission)
    expect(updatedColumns(mock.calls[0]!)).toEqual([
      'id',
      'account_id',
      'kind',
      'source',
      'source_key',
      'note',
      'status',
      'reviewer_note',
      'artifact_id',
      'created_at',
      'decided_at',
    ])
    expect(mock.calls[0]?.params).toContain('approved')
    expect(mock.calls[0]?.params).toContain('npm:test-bundle')
  })

  it('chunk duplicate updates change only non-key fields', async () => {
    const mock = database()
    await new MysqlReadmeTranslationChunkRepository(mock.db).save({
      artifactId: slug('test-bundle'),
      locale: 'ja',
      sourceHash: 'hash',
      chunkIndex: 0,
      chunkCount: 2,
      text: 'Updated',
    })
    expect(updatedColumns(mock.calls[0]!)).toEqual(['chunk_count', 'text', 'updated_at'])
    expect(mock.calls[0]?.params.slice(-3, -1)).toEqual([2, 'Updated'])
  })

  it('prepare discards other source hashes only for the requested artifact and locale', async () => {
    const mock = database(() => [[0], [2]])
    expect(
      await new MysqlReadmeTranslationChunkRepository(mock.db).prepare(
        slug('test-bundle'),
        'ja',
        'hash',
      ),
    ).toEqual(new Set([0, 2]))
    expect(mock.calls[0]?.sql).toContain('source_hash` <> ?')
    expect(mock.calls[0]?.params).toEqual(['test-bundle', 'ja', 'hash'])
    expect(mock.calls[1]?.params).toEqual(['test-bundle', 'ja', 'hash'])
  })

  it.each([
    {
      rows: [
        [0, 2, 'A'],
        [1, 2, 'B'],
      ],
      expected: 'AB',
    },
    { rows: [[0, 2, 'A']], expected: undefined },
    {
      rows: [
        [0, 2, 'A'],
        [2, 2, 'B'],
      ],
      expected: undefined,
    },
    {
      rows: [
        [0, 3, 'A'],
        [1, 3, 'B'],
      ],
      expected: undefined,
    },
  ])('assembles only complete contiguous chunks: $rows', async ({ rows, expected }) => {
    const mock = database(() => rows)
    expect(
      await new MysqlReadmeTranslationChunkRepository(mock.db).assemble(
        slug('test-bundle'),
        'ja',
        'hash',
        2,
      ),
    ).toBe(expected)
    expect(mock.calls[0]?.sql).toContain(
      'order by `artifact_readme_translation_chunks`.`chunk_index` asc',
    )
  })
})
