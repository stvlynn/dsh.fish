# ADR 0009: Pre-aggregate the filter rails instead of aggregating per request

## Status

Accepted. Extends ADR 0008 ("fix the query, not the symptom"); the banned
patterns it cites apply here unchanged.

## Context

D1 kept exceeding its CPU budget (`7429`, "overloaded, requests queued for too
long" / "exceeded its CPU time limit and was reset") and `/`, `/browse` and
`/category/*` intermittently returned 500.

`wrangler d1 insights` put the load at ~7.5 billion rows read per day. The top
three entries were the filter rails, not catalog pages:

| query | runs / 24h | avg rows read | total rows |
| --- | --- | --- | --- |
| `select category_id, count(*) from artifact_categories where artifact_id in (select id from artifacts where deprecated = 0) group by category_id` | 19,808 | 73,259 | 1.45 B |
| the same aggregate over `artifact_topics` | 19,913 | 63,960 | 1.27 B |
| `select kind, count(*) from artifacts where deprecated = 0 group by kind` | 25,328 | 12,924 | 0.33 B |

ADR 0008 made the sort queries cheap with covering indexes. That fix does not
transfer here: `deprecated = 0` matches almost every row, so the aggregations
are necessarily full scans of 30k association rows. An index changes which
rows are visited, never how many.

The KV facet cache (60s TTL) was supposed to keep this to about 1,440 runs a
day. It saw about 20,000. Each refresh window let every isolate miss at once
and hit D1 together; while D1 was slow nobody could write the cache back, so
the thundering herd repeated. A cache whose misses all arrive at the same
instant is a load amplifier, not a load shedder.

## Decision

The rails are pre-aggregated. `catalog_facet_counts` (migration `0015`) holds
one row per `(dimension, facet_id)` for `kind`, `category`, `topic` plus a
`meta` row, so "never computed" and "empty catalog" stay distinguishable.

1. **Request path reads about 35 rows.** `readFacetCounts()` is a single scan
   of a tiny table. No aggregation, no cache, nothing to stampede.
2. **`RefreshCatalogFacets` owns the expensive part.** It runs on the hourly
   cron after ingestion and reclassification settle, rebuilding the table in
   one atomic `db.batch`: readers see the previous counts or the new ones,
   never a half-built table.
3. **The KV facet cache is deleted.** With a table read this cheap it only adds
   a second failure mode and a herd window. Deleting it also removes the
   `CatalogFacetCache` port.
4. **Missing counts fail loudly.** If the table is empty the use case throws.
   It does not render zeroes, which is the fallback ADR 0008 rejected.
5. **`0015` backfills the table**, so applying the migration is enough to make
   the first deploy correct; no manual step.

Cost: rail counts can lag by up to the cron interval. Ingestion and
reclassification both complete before the refresh in the same tick, so the
usual lag is one ingest cycle rather than an hour of live edits.

## Evidence

Measured on a synthetic database built from the real migrations at production
scale (12,926 artifacts, 30,161 category rows, 19,389 topic rows; 5.6 KB
READMEs, matching the production 494 MB / 12,926-row ratio).

| per facet request | before | after |
| --- | --- | --- |
| SQLite VM steps | 996,158 | 216 |
| pages touched | 51,667 | 11 |
| plan | covering-index scans plus temp B-tree | `SCAN catalog_facet_counts` |

One refresh costs about 10 ms, once an hour. See
[`../backend/database.md`](../backend/database.md) for the column contract.

## Alternatives considered

- **A longer TTL or single-flight on the KV cache.** Helps one window, then
  fails open again on a cold KV or a deploy. The work underneath is unchanged.
  Rejected: it hides a cost instead of removing it.
- **Read replication.** `read_replication.mode` is `disabled` on this database
  and enabling it would relieve CPU on the primary. It does not reduce rows
  read, which is what is being billed and what is queuing. Worth doing, but as
  its own change, not as the fix for this.
- **Retrying 7429.** The documented retry pattern covers lost connections, not
  overload. Retrying an overloaded database multiplies the queue. Rejected.
- **Caching the failure.** Already rejected by ADR 0008 and still forbidden by
  `AGENTS.md`.

