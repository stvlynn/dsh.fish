import { DurableObject } from 'cloudflare:workers'

export const CATALOG_QUERY_LEASE_MS = 120_000
export const CATALOG_QUERY_BUDGET_PER_MINUTE = 120
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type BudgetRow = { window_id: number; used: number }

type LeaseRow = {
  token: string
  expires_at: number
}

/** One named SQLite-backed object owns the global expensive-query slot. */
export class CatalogQueryAdmission extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS catalog_query_budget (slot INTEGER PRIMARY KEY CHECK (slot = 1), window_id INTEGER NOT NULL, used INTEGER NOT NULL)',
    )
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS catalog_query_lease (slot INTEGER PRIMARY KEY CHECK (slot = 1), token TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    )
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    if (path === '/acquire') {
      // No await between reading and reserving. transactionSync commits before
      // the grant leaves the object, including across eviction/reinstantiation.
      return this.ctx.storage.transactionSync(() => {
        const now = Date.now()
        const windowId = Math.floor(now / 60_000)
        const budget = this.ctx.storage.sql
          .exec<BudgetRow>('SELECT window_id, used FROM catalog_query_budget WHERE slot = 1')
          .toArray()[0]
        const used = budget?.window_id === windowId ? budget.used : 0
        if (used >= CATALOG_QUERY_BUDGET_PER_MINUTE)
          return new Response(null, {
            status: 429,
            headers: {
              'cache-control': 'no-store',
              'retry-after': String(Math.max(1, Math.ceil(((windowId + 1) * 60_000 - now) / 1000))),
            },
          })
        const lease = this.ctx.storage.sql
          .exec<LeaseRow>('SELECT token, expires_at FROM catalog_query_lease WHERE slot = 1')
          .toArray()[0]
        if (lease !== undefined && lease.expires_at > now) {
          return new Response(null, {
            status: 429,
            headers: {
              'retry-after': '1',
              'cache-control': 'no-store',
            },
          })
        }
        const token = crypto.randomUUID()
        const expiresAt = now + CATALOG_QUERY_LEASE_MS
        this.ctx.storage.sql.exec(
          'INSERT INTO catalog_query_lease (slot, token, expires_at) VALUES (1, ?, ?) ON CONFLICT(slot) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at',
          token,
          expiresAt,
        )
        this.ctx.storage.sql.exec(
          'INSERT INTO catalog_query_budget (slot, window_id, used) VALUES (1, ?, ?) ON CONFLICT(slot) DO UPDATE SET window_id = excluded.window_id, used = excluded.used',
          windowId,
          used + 1,
        )
        return Response.json({ token, expiresAt }, { headers: { 'cache-control': 'no-store' } })
      })
    }
    if (path === '/release') {
      const token = request.headers.get('x-catalog-query-token')
      if (token === null || !TOKEN_PATTERN.test(token)) return new Response(null, { status: 400 })
      this.ctx.storage.transactionSync(() => {
        // Repeated releases and a late owner after expiry cannot clear a new owner.
        this.ctx.storage.sql.exec(
          'DELETE FROM catalog_query_lease WHERE slot = 1 AND token = ?',
          token,
        )
      })
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 404 })
  }
}
