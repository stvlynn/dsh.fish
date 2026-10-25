import { createPool } from 'mysql2/promise'
import { Redis } from 'ioredis'
import type { ConnectionOptions } from 'bullmq'
import type { HubEnv } from '../config/env.js'
import { createMysqlPersistence } from '../persistence/open-persistence.js'
import { RedisStore } from './redis-store.js'
import { NodeJobs } from './jobs.js'

export async function createNodeRuntime(values: NodeJS.ProcessEnv, locales: readonly string[]) {
  const translationEnabled = values.TRANSLATION_ENABLED === 'true'
  const pool = createPool({
    host: required(values, 'MYSQL_HOST'),
    port: integer(values.MYSQL_PORT ?? '3306', 'MYSQL_PORT'),
    database: required(values, 'MYSQL_DATABASE'),
    user: required(values, 'MYSQL_USER'),
    password: required(values, 'MYSQL_PASSWORD'),
    charset: 'utf8mb4',
    disableEval: true,
    connectionLimit: 6,
    maxIdle: 6,
    queueLimit: 16,
    waitForConnections: true,
    connectTimeout: 5_000,
    enableKeepAlive: true,
    multipleStatements: false,
  })
  const redisUrl = new URL(required(values, 'REDIS_URL'))
  const connection: ConnectionOptions = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
  }
  const redis = new Redis({ ...connection, lazyConnect: true })
  redis.on('error', () => console.error(JSON.stringify({ event: 'redis_connection_error' })))
  try {
    await redis.connect()
    await pool.query('SELECT 1')
    const owner = createMysqlPersistence(pool, locales)
    // Requests and jobs borrow the process pool; only shutdown closes its owner.
    const persistence = { ...owner, dispose: async () => {} }
    const env: HubEnv = {
      ...values,
      RUNTIME: 'node',
      STORAGE_BACKEND: 'mysql',
      PUBLIC_BASE_URL: required(values, 'PUBLIC_BASE_URL'),
      BETTER_AUTH_SECRET: required(values, 'BETTER_AUTH_SECRET'),
      GITHUB_CLIENT_ID: required(values, 'GITHUB_CLIENT_ID'),
      GITHUB_CLIENT_SECRET: required(values, 'GITHUB_CLIENT_SECRET'),
      KV: new RedisStore(redis),
      I18N_MODEL: {
        async fetch(request: Request) {
          if (request.url !== 'https://opencode.ai/inference/openai/v1/chat/completions')
            throw new Error('Unsupported translation endpoint.')
          return fetch(request, {
            signal: AbortSignal.timeout(90_000),
          })
        },
      } as Pick<Fetcher, 'fetch'>,
    }
    const jobs = new NodeJobs(connection, env, persistence, locales)
    return {
      env,
      persistence,
      jobs,
      redis,
      ready: async () => {
        await Promise.all([pool.query('SELECT 1'), redis.ping()])
      },
      start: () => jobs.start(translationEnabled),
      close: async () => {
        await jobs.close()
        await redis.quit()
        await owner.dispose()
      },
    }
  } catch (error) {
    redis.disconnect()
    await pool.end()
    throw error
  }
}

export function required(values: NodeJS.ProcessEnv, key: string): string {
  const value = values[key]?.trim()
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function integer(value: string, key: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error(`Invalid ${key}.`)
  return parsed
}
