import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise'
import { eq, inArray } from 'drizzle-orm'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { BetterAuthOptions } from 'better-auth'
import { createAuth, HUB_PLUGIN_CLIENT_ID, type HubAuth } from './auth.js'
import { readRequestSession } from './request-session.js'
import type { HubEnv } from '../config/env.js'
import * as schema from '../persistence/mysql-schema.js'

// Explicit opt-in, validation schema only. Never log configuration or existing identities.
const configPath = process.env.MYSQL_TEST_CONFIG
const databaseName = 'dsh_fish_validation'
const configSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  user: z.string().min(1),
  password: z.string(),
  ca: z.string().min(1),
  tls_server_name: z.string().min(1),
})

class MemoryKV {
  private readonly values = new Map<string, { value: string; expiresAt?: number }>()
  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key)
    if (!entry || (entry.expiresAt !== undefined && entry.expiresAt <= Date.now())) return null
    return entry.value
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, {
      value,
      ...(options?.expirationTtl === undefined
        ? {}
        : {
            expiresAt: Date.now() + options.expirationTtl * 1000,
          }),
    })
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
  clear(): void {
    this.values.clear()
  }
}

describe.skipIf(configPath === undefined)('MySQL auth in the isolated validation database', () => {
  let pool: Pool
  let db: MySql2Database<typeof schema>
  let auth: HubAuth
  let context: Awaited<HubAuth['$context']>
  let kv: MemoryKV
  let prefix: string
  let secret: string
  const ids = new Map<string, Set<string>>()
  const userIds = new Set<string>()
  const emails = new Set<string>()
  const verificationIdentifiers = new Set<string>()

  beforeAll(async () => {
    const parsed = configSchema.safeParse(JSON.parse(readFileSync(configPath!, 'utf8')))
    if (!parsed.success) throw new Error('Invalid MySQL validation configuration')
    const config = parsed.data
    try {
      pool = createPool({
        host: config.tls_server_name,
        port: config.port,
        user: config.user,
        password: config.password,
        database: databaseName,
        connectionLimit: 4,
        stream: () => createConnection({ host: config.host, port: config.port }),
        ssl: {
          ca: readFileSync(config.ca, 'utf8'),
          rejectUnauthorized: true,
          verifyIdentity: true,
        },
      })
      const [rows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS schema_name')
      expect(rows.map((row) => row['schema_name'])).toEqual([databaseName])
      db = drizzle(pool, { schema, mode: 'default' })
    } catch {
      // Authentication/network errors must not disclose the supplied credentials.
      throw new Error('Could not open the isolated TLS MySQL validation database')
    }
  })

  beforeEach(async () => {
    prefix = 'auth-test-' + randomUUID()
    secret = randomUUID() + randomUUID()
    kv = new MemoryKV()
    ids.clear()
    userIds.clear()
    emails.clear()
    verificationIdentifiers.clear()
    const env = {
      STORAGE_BACKEND: 'mysql',
      DB: {} as never,
      KV: kv as never,
      ASSETS: {} as never,
      README_I18N_AGENT: {} as never,
      I18N_MODEL: {} as never,
      PUBLIC_BASE_URL: 'https://auth-validation.invalid',
      BETTER_AUTH_SECRET: secret,
    } satisfies HubEnv
    auth = createAuth(env, undefined, env.PUBLIC_BASE_URL, db)
    context = await auth.$context
    // Change only fixture ID generation; exercise the actual factory's storage/options.
    const options = context.options as BetterAuthOptions
    options.advanced = {
      ...options.advanced,
      database: {
        ...options.advanced?.database,
        generateId: ({ model }) => {
          const id = prefix + '-' + randomUUID()
          if (!ids.has(model)) ids.set(model, new Set())
          ids.get(model)!.add(id)
          return id
        },
      },
    }
  })

  afterEach(async () => {
    if (!db) return
    // Recover only exact UUID fixture emails if an insertion succeeded before an assertion failed.
    for (const email of emails) {
      const rows = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
      for (const row of rows) userIds.add(row.id)
    }
    for (const model of ['deviceCode', 'verification']) {
      const own = [...(ids.get(model) ?? [])]
      if (own.length === 0) continue
      if (model === 'deviceCode')
        await db.delete(schema.deviceCodes).where(inArray(schema.deviceCodes.id, own))
      else await db.delete(schema.verifications).where(inArray(schema.verifications.id, own))
    }
    for (const identifier of verificationIdentifiers) {
      await db.delete(schema.verifications).where(eq(schema.verifications.identifier, identifier))
    }
    for (const id of userIds) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id))
      await db.delete(schema.accounts).where(eq(schema.accounts.userId, id))
      await db.delete(schema.users).where(eq(schema.users.id, id))
      expect(
        await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)),
      ).toHaveLength(0)
    }
    kv?.clear()
  })
  afterAll(async () => {
    if (pool) await pool.end()
  })

  async function user() {
    const email = prefix + '@example.invalid'
    emails.add(email)
    const createdAt = new Date(1_700_000_000_123)
    const result = await context.internalAdapter.createUser({
      name: prefix,
      email,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    })
    userIds.add(result.id)
    return result
  }
  function cookie(token: string, signingSecret = secret) {
    const signature = createHmac('sha256', signingSecret).update(token).digest('base64')
    return context.authCookies.sessionToken.name + '=' + encodeURIComponent(token + '.' + signature)
  }
  const post = (path: string, body: Record<string, string>) =>
    auth.handler(
      new Request('https://auth-validation.invalid/api/auth' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://auth-validation.invalid' },
        body: JSON.stringify(body),
      }),
    )
  async function issueDevice(userId: string) {
    const response = await post('/device/code', {
      client_id: HUB_PLUGIN_CLIENT_ID,
      user_id: userId,
      scope: prefix,
    })
    expect(response.status).toBe(200)
    const payload = z
      .object({
        device_code: z.string(),
        user_code: z.string(),
        expires_in: z.number(),
        interval: z.number(),
      })
      .parse(await response.json())
    const [record] = await db
      .select()
      .from(schema.deviceCodes)
      .where(eq(schema.deviceCodes.deviceCode, payload.device_code))
    if (!record) throw new Error('Fixture device code was not persisted')
    if (!ids.has('deviceCode')) ids.set('deviceCode', new Set())
    ids.get('deviceCode')!.add(record.id)
    return { payload, record }
  }

  it('persists users and sessions as epoch milliseconds and hydrates Date values', async () => {
    const created = await user()
    const read = await context.internalAdapter.findUserById(created.id)
    expect(read?.createdAt).toBeInstanceOf(Date)
    expect(read?.createdAt.getTime()).toBe(1_700_000_000_123)
    const timestamp = new Date(Date.now() - 10_000)
    const session = await context.internalAdapter.createSession(
      created.id,
      false,
      {
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      true,
    )
    const [stored] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.id))
    expect(stored?.createdAt).toBeInstanceOf(Date)
    expect(stored?.createdAt.getTime()).toBe(timestamp.getTime())
    const [raw] = await pool.query<RowDataPacket[]>(
      'SELECT created_at FROM sessions WHERE id = ?',
      [session.id],
    )
    expect(Number(raw[0]?.['created_at'])).toBe(timestamp.getTime())
    kv.clear()
    const found = await context.internalAdapter.findSession(session.token)
    expect(found?.user.id).toBe(created.id)
    expect(found?.session.expiresAt).toBeInstanceOf(Date)
    expect(found?.session.createdAt.getTime()).toBe(timestamp.getTime())
  })

  it('reads a pre-cutover signed cookie with cold KV and rejects wrong signatures or deleted sessions', async () => {
    const created = await user()
    const token = prefix + '-legacy-token'
    const id = prefix + '-legacy-session'
    await db.insert(schema.sessions).values({
      id,
      token,
      userId: created.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(1_700_000_000_123),
      updatedAt: new Date(1_700_000_000_123),
    })
    const headers = new Headers({ cookie: cookie(token) })
    const found = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true, disableRefresh: true },
    })
    expect(found?.user.id).toBe(created.id)
    expect(found?.session.createdAt.getTime()).toBe(1_700_000_000_123)
    expect(
      await auth.api.getSession({
        headers: new Headers({ cookie: cookie(token, 'wrong-secret') }),
      }),
    ).toBeNull()
    expect(
      (
        await readRequestSession(
          auth,
          new Request('https://auth-validation.invalid', {
            headers: { authorization: 'Bearer ' + token },
          }),
        )
      )?.user.id,
    ).toBe(created.id)
    await context.internalAdapter.deleteSession(token)
    expect(await context.internalAdapter.findSession(token)).toBeNull()
    expect(
      await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      }),
    ).toBeNull()
  })

  it('issues device codes with persisted Dates and redeems exactly once', async () => {
    const created = await user()
    const { payload, record } = await issueDevice(created.id)
    expect(payload.user_code).toMatch(/^[0-9]{8}$/)
    expect(payload.expires_in).toBe(900)
    expect(payload.interval).toBe(5)
    expect(record.status).toBe('pending')
    expect(record.expiresAt).toBeInstanceOf(Date)
    expect(record.userId).toBe(created.id)
    await db
      .update(schema.deviceCodes)
      .set({ status: 'approved', lastPolledAt: null })
      .where(eq(schema.deviceCodes.id, record.id))
    const body = {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: payload.device_code,
      client_id: HUB_PLUGIN_CLIENT_ID,
    }
    const first = await post('/device/token', body)
    expect(first.status).toBe(200)
    const token = z.object({ access_token: z.string() }).parse(await first.json()).access_token
    expect((await context.internalAdapter.findSession(token))?.user.id).toBe(created.id)
    const second = await post('/device/token', body)
    expect(second.status).toBe(400)
    expect(await second.json()).toMatchObject({ error: 'invalid_grant' })
    expect(
      await db
        .select({ id: schema.deviceCodes.id })
        .from(schema.deviceCodes)
        .where(eq(schema.deviceCodes.id, record.id)),
    ).toHaveLength(0)
  })

  it('atomically consumes one database verification under concurrent connections without touching a sibling', async () => {
    const identifier = prefix + '-verification'
    const sibling = prefix + '-sibling'
    verificationIdentifiers.add(identifier)
    verificationIdentifiers.add(sibling)
    const expiresAt = new Date(Date.now() + 60_000)
    await context.adapter.create({
      model: 'verification',
      data: { identifier, value: prefix, expiresAt, createdAt: new Date(), updatedAt: new Date() },
    })
    await context.adapter.create({
      model: 'verification',
      data: {
        identifier: sibling,
        value: prefix,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    const consume = () =>
      context.adapter.consumeOne({
        model: 'verification',
        where: [{ field: 'identifier', value: identifier }],
      })
    const results = await Promise.all([consume(), consume(), consume(), consume()])
    expect(results.filter((result) => result !== null)).toHaveLength(1)
    expect(await consume()).toBeNull()
    expect(
      await context.adapter.findOne({
        model: 'verification',
        where: [{ field: 'identifier', value: sibling }],
      }),
    ).not.toBeNull()
    // This internal API consumes only its identifier; never call the global expired-row cleanup reader.
    const cachedIdentifier = prefix + '-cached-verification'
    verificationIdentifiers.add(cachedIdentifier)
    await context.internalAdapter.createVerificationValue({
      identifier: cachedIdentifier,
      value: prefix,
      expiresAt,
    })
    const cached = await Promise.all([
      context.internalAdapter.consumeVerificationValue(cachedIdentifier),
      context.internalAdapter.consumeVerificationValue(cachedIdentifier),
    ])
    expect(cached.filter((result) => result !== null)).toHaveLength(1)
  })

  it('rejects expired device grants and deletes only that fixture', async () => {
    const created = await user()
    const { payload, record } = await issueDevice(created.id)
    await db
      .update(schema.deviceCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.deviceCodes.id, record.id))
    const response = await post('/device/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: payload.device_code,
      client_id: HUB_PLUGIN_CLIENT_ID,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'expired_token' })
    expect(
      await db
        .select({ id: schema.deviceCodes.id })
        .from(schema.deviceCodes)
        .where(eq(schema.deviceCodes.id, record.id)),
    ).toHaveLength(0)
  })
})
