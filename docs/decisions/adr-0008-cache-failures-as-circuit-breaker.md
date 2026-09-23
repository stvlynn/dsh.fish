# ADR 0008: Cache-backed failures as a circuit breaker

## Status

Accepted.

## Context

Facet counts are shared by home, browse, `GET /api/v1/facets` and the page
sitemap, and they do not vary with `q` or any filter query string. They were
cached in KV under `catalog:facets:v1` with a 60-second TTL, but
`ListCatalogFacets.execute()` wrote the cache only *after* the aggregation
resolved:

```ts
const cached = await this.cache?.read()
if (cached !== undefined) return cached
const facets = await this.loadFromCatalog()   // throws under D1 overload
await this.cache?.write(facets)               // never reached
```

Cloudflare documents D1 as single-threaded, one query at a time: roughly 1,000
queries/second at 1 ms each, but only about 10/second at 100 ms each. The facet
aggregations average 13-18 ms and read ~53k rows, so sustained crawl traffic is
enough to queue the database until it returns `7429`.

That produced a self-sustaining loop that lasted for days: overload →
aggregation throws → cache never written → the next request also misses → more
load. A cache that is only populated on the success path cannot protect a
dependency that is currently failing.

## Decision

When a catalog aggregation fails and a cache is configured, log the failure and
write a zeroed-but-well-formed facet payload to the cache, then return it.

- The fallback keeps every kind, category and topic listed with `count: 0`,
  matching the contract the use case already documents ("every kind is listed
  even at count zero").
- It uses the cache's own short TTL, so it is a circuit breaker, not a durable
  answer.
- When no cache is configured, the error still propagates: there is nowhere to
  break the cycle, so failing loudly is better than silently zeroed rails.

## Consequences

A brief D1 overload now sheds load instead of amplifying it: the first failing
request pays for the aggregation and every caller within the TTL window is
served from KV. The filter rails temporarily show zeros — that is a deliberate,
visible degradation, and it is cheaper than a 500 on every page.

The trade-off is that a genuinely failing database looks "healthy" from the
outside, because pages still render. `catalog_facets_unavailable` is logged on
every fallback so the condition stays observable.

## Alternatives considered

- **Let the error propagate and render an error page.** Rejected: it is what
  the site already did, and it is what let the overload persist.
- **Disable the cron triggers to shed load.** Rejected: `d1 insights` showed
  the load was request-driven, not cron-driven (writes were ~30k rows/day
  against ~39 billion rows read).
- **Serve facets from a separate precomputed table.** More correct in the long
  run, but it is a schema and ingestion change; the circuit breaker is needed
  to stop the bleeding first.

## Related decisions

The same reasoning now covers the other catalog reads that fail first under
load:

- `GetCatalogSnapshot.meta()` records its last successful result in KV and
  serves it when `catalogStats()` throws; `snapshot()` serves the last built
  document when the catalog walk throws. Without a recorded value the error
  still propagates.
- Home and browse loaders wrap each rail in
  `emptyPageOnCatalogFailure` (`frontend/src/shared/lib/catalog-degraded-page.ts`),
  so one unreadable rail renders empty instead of 500ing the page.

## References

- [`../backend/database.md`](../backend/database.md) — catalog columns, covering indexes.
- [`adr-0006-locale-gated-fts-search.md`](adr-0006-locale-gated-fts-search.md) — the FTS/`%LIKE%` read path behind the same overload.
