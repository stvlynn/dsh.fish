# Infrastructure Layer

The infrastructure layer implements the abstractions that the domain layer defines. It contains all framework, database, and external-service code.

## What belongs in `infrastructure/`

- **Repository implementations** — D1 and MySQL adapters for the same domain
  ports. Production uses private TencentDB MySQL; D1 is a frozen backup.
- **External service clients** — HTTP clients, SDK wrappers, message publishers.
- **Messaging adapters** — event bus, queue producers/consumers.
- **Agent adapters** — BullMQ consumers, the shared localization processor,
  pinned OpenCode translation transport, resumable MySQL chunks, and
  scheduler/backfill adapters behind application ports.
- **Ada client** — `AdaClient` POSTs `https://api.devin.ai/ada/query` (Fast)
  then opens the query WebSocket. Live Fast tokens arrive as
  `{ type: "chunk", data: "<token>" }`; the adapter also accepts recorded
  `text` / `delta` / `chunk` fixtures. Frames map to `AskEvent`; file bodies
  and Ada JSON never leave the adapter. The SSE response sets
  `Content-Encoding: none` so the edge does not gzip-buffer the stream.
  Timeouts: connect 10s, idle 30s, total 60s. Upstream 429/5xx become
  `UNAVAILABLE`.
- **Catalog facet counts** — `catalog_facet_counts`, read through the repository
  port and rebuilt atomically: D1 `db.batch`, MySQL `db.transaction`. Home, browse
  and `GET /api/v1/facets` share that persisted projection. Assembled rail DTOs
  and catalog snapshots also use KV; MySQL catalog cache keys and edge responses
  have a `mysql-v1` namespace. Auth secondary storage uses Redis in Node and KV in the retained adapter and is not purged with catalog caches.
- **Ask rate limiter** — `KvAskRateLimiter` on the existing `KV` binding:
  12 asks / IP / 10 min, 4 concurrent streams / IP, 30 asks / artifact / hour,
  60 asks / Worker / minute. Consume/release is serialized inside one Worker
  isolate so a burst cannot overshoot those counters; Ada 429 trips a 5-minute
  circuit.
- **Configuration and environment access** — reading env vars, config files.
- **Framework-specific code** — ORM mappings, database migrations, cache integrations.

## Node runtime adapters

The [VPS runtime](../operations/vps-deployment.md) implements the same use cases
with Redis, BullMQ and a process-owned MySQL pool. Translation processing is
shared with the Agent adapter. Each borrowed request/job handle has a no-op
release; only the runtime owner closes the underlying pool during shutdown.
The `KeyValueStore` port keeps cache and cursor consumers independent of the
Cloudflare binding shape. Node uses its native WebSocket API for Ada.

## Persistence lifecycle and cutover controls

[open-persistence.ts](../../backend/src/infrastructure/persistence/open-persistence.ts)
selects storage per request/invocation. MySQL pools open lazily without an
unconditional readiness query; the first real SQL operation fails explicitly
without a silent D1 fallback. Its MySQL pool is bounded to two connections; each transaction
leases an exclusive connection. Never retain the pool in global Worker or Agent
state. Hyperdrive owns cross-request origin pooling.

Costly MySQL catalog cache misses reserve one atomic global SQLite Durable
Object lease and minute budget. Excess queries return 429 before persistence
opens. A per-request pool is not a Worker-wide limit; KV get-plus-put is not
an atomic concurrency lock.

The async container and its persistence handle remain alive until the response
body/stream and registered background work finish, then dispose exactly once.
Agents open/dispose persistence for each invocation, including retries. Scheduled
ingestion/reclassification/facet work runs serially to bound origin concurrency.

`CATALOG_SEARCH_PAUSED` and `CATALOG_CRON_PAUSED` stay paused unless explicitly
`false`. `CATALOG_WRITES_PAUSED=true` is a maintenance barrier for every non-health
application request, including GET side effects and auth routes; scheduled work
stops and Agent localization/retry work defers. Drain existing work before the
final source snapshot. These controls do not make D1 a safe rollback after MySQL
has accepted new writes: stop writes and reverse-sync or forward-fix instead.

## Rules

- Infrastructure depends on `domain` and `application`. It never contains business rules.
- Implement domain ports, do not invent new interfaces unless needed.
- Keep mapping code explicit. Transform between persistence models and domain entities in one place.
- Do not leak infrastructure details into `application` or `domain`.

## Example

```ts
// infrastructure/persistence/sql-order-repository.ts
export class SqlOrderRepository implements OrderRepository {
  constructor(private readonly db: Database) {}

  async findById(id: OrderId): Promise<Order | null> {
    const row = await this.db.query('orders').where('id', id.value).first();
    return row ? this.toDomain(row) : null;
  }

  async save(order: Order): Promise<void> {
    const row = this.toPersistence(order);
    await this.db('orders').insert(row).onConflict('id').merge();
  }

  private toDomain(row: OrderRow): Order { /* ... */ }
  private toPersistence(order: Order): OrderRow { /* ... */ }
}
```

## External services

- Wrap third-party APIs in thin adapters.
- Define the port in `domain/` or `application/` and implement it here.
- Failures in external services should be translated into domain or application errors, not leaked as raw HTTP errors.
