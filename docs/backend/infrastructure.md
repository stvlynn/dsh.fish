# Infrastructure Layer

The infrastructure layer implements the abstractions that the domain layer defines. It contains all framework, database, and external-service code.

## What belongs in `infrastructure/`

- **Repository implementations** — concrete persistence for domain aggregates.
- **External service clients** — HTTP clients, SDK wrappers, message publishers.
- **Messaging adapters** — event bus, queue producers/consumers.
- **Agent adapters** — Cloudflare Agent classes, durable task queues, the
  OpenCode Go HTTP client, and scheduler/backfill adapters behind application
  ports.
- **Ada client** — `AdaClient` POSTs `https://api.devin.ai/ada/query` (Fast)
  then opens the query WebSocket. Live Fast tokens arrive as
  `{ type: "chunk", data: "<token>" }`; the adapter also accepts recorded
  `text` / `delta` / `chunk` fixtures. Frames map to `AskEvent`; file bodies
  and Ada JSON never leave the adapter. The SSE response sets
  `Content-Encoding: none` so the edge does not gzip-buffer the stream.
  Timeouts: connect 10s, idle 30s, total 60s. Upstream 429/5xx become
  `UNAVAILABLE`.
- **Catalog facet cache** — `KvCatalogFacetCache` on the existing `KV` binding.
  Home, browse, and `GET /api/v1/facets` share one 60s snapshot of the facet
  DTO so unique search URLs do not each re-run the three aggregations.
- **Ask rate limiter** — `KvAskRateLimiter` on the existing `KV` binding:
  12 asks / IP / 10 min, 4 concurrent streams / IP, 30 asks / artifact / hour,
  60 asks / Worker / minute. Consume/release is serialized inside one Worker
  isolate so a burst cannot overshoot those counters; Ada 429 trips a 5-minute
  circuit.
- **Configuration and environment access** — reading env vars, config files.
- **Framework-specific code** — ORM mappings, database migrations, cache integrations.

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
