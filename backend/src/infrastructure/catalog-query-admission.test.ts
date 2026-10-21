import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CatalogQueryAdmission,
  CATALOG_QUERY_LEASE_MS,
  CATALOG_QUERY_BUDGET_PER_MINUTE,
} from './catalog-query-admission.js'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: unknown,
    ) {}
  },
}))

const databases: DatabaseSync[] = []
function storage() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  return {
    sql: {
      exec: (query: string, ...bindings: (string | number)[]) => {
        const statement = db.prepare(query)
        const rows = statement.all(...bindings)
        return { toArray: () => rows }
      },
    },
    transactionSync: <T>(callback: () => T): T => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const value = callback()
        db.exec('COMMIT')
        return value
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}
function instantiate(persisted = storage()) {
  return new CatalogQueryAdmission({ storage: persisted } as unknown as DurableObjectState, {})
}
const acquire = (object: CatalogQueryAdmission) =>
  object.fetch(new Request('https://admission.internal/acquire', { method: 'POST' }))
const release = (object: CatalogQueryAdmission, token?: string) =>
  object.fetch(
    new Request('https://admission.internal/release', {
      method: 'POST',
      ...(token === undefined ? {} : { headers: { 'x-catalog-query-token': token } }),
    }),
  )
async function grant(object: CatalogQueryAdmission): Promise<{ token: string; expiresAt: number }> {
  const response = await acquire(object)
  expect(response.status).toBe(200)
  return response.json()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})

describe('persisted global catalog query lease', () => {
  it('atomically enforces the per-minute budget across releases and restarts', async () => {
    const persisted = storage()
    const object = instantiate(persisted)
    for (let i = 0; i < CATALOG_QUERY_BUDGET_PER_MINUTE; i++) {
      const lease = await grant(object)
      await release(object, lease.token)
    }
    const rejected = await acquire(instantiate(persisted))
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBe('60')
    vi.setSystemTime(Date.now() + 60_000)
    expect((await acquire(instantiate(persisted))).status).toBe(200)
  })
  it('does not spend budget on rejected overlapping acquires', async () => {
    const persisted = storage()
    const object = instantiate(persisted)
    await grant(object)
    await Promise.all(Array.from({ length: 10 }, () => acquire(object)))
    expect(
      persisted.sql.exec('SELECT used FROM catalog_query_budget WHERE slot = 1').toArray()[0]?.used,
    ).toBe(1)
  })
  it('grants one slot and rejects concurrent acquires without queueing', async () => {
    const object = instantiate()
    const responses = await Promise.all(Array.from({ length: 20 }, () => acquire(object)))
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(19)
    const rejected = responses.find((response) => response.status === 429)!
    expect(rejected.headers.get('retry-after')).toBe('1')
    expect(rejected.headers.get('cache-control')).toBe('no-store')
    const lease = (await responses.find((response) => response.status === 200)!.json()) as {
      expiresAt: number
    }
    expect(lease.expiresAt).toBe(Date.now() + CATALOG_QUERY_LEASE_MS)
  })

  it('retains the slot after reinstantiate and only frees it for its token', async () => {
    const persisted = storage()
    const original = instantiate(persisted)
    const first = await grant(original)
    const restarted = instantiate(persisted)
    expect((await acquire(restarted)).status).toBe(429)
    expect((await release(restarted, crypto.randomUUID())).status).toBe(204)
    expect((await acquire(restarted)).status).toBe(429)
    expect((await release(restarted, first.token)).status).toBe(204)
    const second = await grant(restarted)
    expect(second.token).not.toBe(first.token)
    expect((await release(original, first.token)).status).toBe(204)
    expect((await acquire(restarted)).status).toBe(429)
  })

  it('expires exactly at 120 seconds and rejects stale releases after replacement', async () => {
    const persisted = storage()
    const object = instantiate(persisted)
    const first = await grant(object)
    vi.setSystemTime(first.expiresAt - 1)
    const rejected = await acquire(instantiate(persisted))
    expect(rejected.status).toBe(429)
    expect(rejected.headers.get('retry-after')).toBe('1')
    vi.setSystemTime(first.expiresAt)
    const second = await grant(instantiate(persisted))
    expect(second.token).not.toBe(first.token)
    expect((await release(object, first.token)).status).toBe(204)
    expect((await acquire(object)).status).toBe(429)
    await release(object, second.token)
    await release(object, second.token)
    expect((await acquire(object)).status).toBe(200)
  })

  it('does not extend the recovery lease and returns a short retry hint', async () => {
    const object = instantiate()
    const first = await grant(object)
    vi.setSystemTime(first.expiresAt - 1501)
    expect((await acquire(object)).headers.get('retry-after')).toBe('1')
    vi.setSystemTime(first.expiresAt)
    expect((await acquire(object)).status).toBe(200)
  })

  it('rejects malformed tokens and unsupported operations without changing ownership', async () => {
    const object = instantiate()
    await grant(object)
    expect((await release(object)).status).toBe(400)
    expect((await release(object, 'invalid')).status).toBe(400)
    expect((await object.fetch(new Request('https://admission.internal/acquire'))).status).toBe(405)
    expect(
      (await object.fetch(new Request('https://admission.internal/reset', { method: 'POST' })))
        .status,
    ).toBe(404)
    expect((await acquire(object)).status).toBe(429)
  })

  it('fails closed if persisting a reservation fails and rolls back the transaction', async () => {
    const persisted = storage()
    const object = instantiate(persisted)
    const original = persisted.sql.exec
    const failing = vi.spyOn(persisted.sql, 'exec').mockImplementation((query, ...bindings) => {
      if (query.startsWith('INSERT')) throw new Error('storage failure')
      return original(query, ...bindings)
    })
    await expect(acquire(object)).rejects.toThrow('storage failure')
    failing.mockRestore()
    expect((await acquire(instantiate(persisted))).status).toBe(200)
  })
})
