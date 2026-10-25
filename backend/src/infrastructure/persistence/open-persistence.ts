import { drizzle as d1Drizzle } from 'drizzle-orm/d1'
import { drizzle as mysqlDrizzle } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2/promise'
import type { HubEnv } from '../config/env.js'
import { D1ArtifactRepository } from './d1-artifact-repository.js'
import { D1LinkedIdentityReader } from './d1-linked-identity.js'
import { D1ReadmeLocalizationBackfillSource } from './d1-readme-localization-backfill-source.js'
import { D1ReadmeTranslationChunkRepository } from './d1-readme-translation-chunk-repository.js'
import { D1ReadmeTranslationRepository } from './d1-readme-translation-repository.js'
import { D1ReviewRepository } from './d1-review-repository.js'
import { D1SubmissionRepository } from './d1-submission-repository.js'
import { D1SummaryTranslationRepository } from './d1-summary-translation-repository.js'
import { MysqlArtifactRepository } from './mysql-artifact-repository.js'
import { MysqlLinkedIdentityReader } from './mysql-linked-identity.js'
import { MysqlReadmeLocalizationBackfillSource } from './mysql-readme-localization-backfill-source.js'
import { MysqlReadmeTranslationChunkRepository } from './mysql-readme-translation-chunk-repository.js'
import { MysqlReadmeTranslationRepository } from './mysql-readme-translation-repository.js'
import { MysqlReviewRepository } from './mysql-review-repository.js'
import { MysqlSubmissionRepository } from './mysql-submission-repository.js'
import { MysqlSummaryTranslationRepository } from './mysql-summary-translation-repository.js'
import * as d1Schema from './schema.js'
import * as mysqlSchema from './mysql-schema.js'

/** Request-scoped client pool: each transaction leases an exclusive connection.
 * Hyperdrive owns the cross-request origin pool; never cache this client pool. */
export async function openPersistence(env: HubEnv, locales: readonly string[] = ['en']) {
  if (env.STORAGE_BACKEND === 'mysql') {
    if (!env.HYPERDRIVE) throw new Error('MySQL storage requires HYPERDRIVE.')
    const client = createPool({
      host: env.HYPERDRIVE.host,
      port: env.HYPERDRIVE.port,
      user: env.HYPERDRIVE.user,
      password: env.HYPERDRIVE.password,
      database: env.HYPERDRIVE.database,
      disableEval: true,
      charset: 'utf8mb4',
      connectTimeout: 10_000,
      connectionLimit: 2,
      maxIdle: 2,
      waitForConnections: true,
      queueLimit: 16,
    })
    try {
      // Open sockets lazily: cached/static/anonymous-session paths must not queue a probe.
      // The first actual database operation still propagates failures; never fall back to D1.
      return createMysqlPersistence(client, locales)
    } catch (error) {
      await client.end()
      throw error
    }
  }
  if (env.STORAGE_BACKEND !== undefined && env.STORAGE_BACKEND !== 'd1') {
    throw new Error('Unknown STORAGE_BACKEND.')
  }
  if (!env.DB) throw new Error('D1 storage requires DB.')
  const db = d1Drizzle(env.DB, { schema: d1Schema })
  return {
    mysqlDb: undefined,
    artifacts: new D1ArtifactRepository(db, env.CATALOG_FTS_SEARCH === 'true'),
    readmes: new D1ReadmeTranslationRepository(db),
    summaries: new D1SummaryTranslationRepository(db),
    chunks: new D1ReadmeTranslationChunkRepository(db),
    backfill: new D1ReadmeLocalizationBackfillSource(db, locales),
    submissions: new D1SubmissionRepository(db),
    reviews: new D1ReviewRepository(db),
    identities: new D1LinkedIdentityReader(db),
    dispose: async () => {},
  }
}

/** Pool ownership belongs to the runtime: invocation-scoped on Workers, process-scoped on Node. */
export function createMysqlPersistence(
  client: ReturnType<typeof createPool>,
  locales: readonly string[],
) {
  const db = mysqlDrizzle(client, { schema: mysqlSchema, mode: 'default' })
  return {
    mysqlDb: db,
    artifacts: new MysqlArtifactRepository(db),
    readmes: new MysqlReadmeTranslationRepository(db),
    summaries: new MysqlSummaryTranslationRepository(db),
    chunks: new MysqlReadmeTranslationChunkRepository(db),
    backfill: new MysqlReadmeLocalizationBackfillSource(db, locales),
    submissions: new MysqlSubmissionRepository(db),
    reviews: new MysqlReviewRepository(db),
    identities: new MysqlLinkedIdentityReader(db),
    dispose: () => client.end(),
  }
}

export type Persistence = Awaited<ReturnType<typeof openPersistence>>
