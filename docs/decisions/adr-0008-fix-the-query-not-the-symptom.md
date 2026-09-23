# ADR 0008: Fix the query, not the symptom

## Status

Accepted. Supersedes an earlier ADR of the same number that proposed caching a
zeroed fallback when the catalog read failed.

## Context

Production served 500s on `/`, `/browse` and `/api/v1/facets` for days. D1 was
returning `7429` ("exceeded its CPU time limit" / "overloaded, requests queued
too long"). `d1 insights` put the load at ~39 billion rows read per day, 37.8
billion of it in three facet aggregations.

The first response was to make the failures invisible: cache a zeroed facet
payload when the aggregation threw, render empty rails instead of 500ing the
page, and mark the degraded document `no-store`. It stopped the 500s.

It was also wrong. `AGENTS.md` lists this as a forbidden pattern:

> **No fallback/clever bypass logic.** Do not mask a root cause with a default
> value, a silent catch, or a conditional shortcut. Face the actual problem and
> fix it, or ask the user.

The cached failure then outlived the outage it was hiding: a home page rendered
with zeroed counts during a D1 blip was stored by the edge cache and served for
hours after the database recovered. Visitors saw an empty site and there was no
error anywhere to explain it.

## Decision

Catalog reads fail loudly. The fix for an expensive read is to make it cheap,
not to answer for it with a default:

1. **Match the index to the sort key.** `sort=popular` orders by
   `popularity DESC, updated_at DESC, id DESC`, but the only index was
   `(deprecated, popularity)`. SQLite fell back to `(deprecated, updated_at)`,
   read all 22,039 rows and sorted them in a temporary B-tree (~850 ms).
   `(deprecated, popularity, updated_at, id)` turns it into
   `SEARCH ... USING COVERING INDEX`: 6 rows, ~0.24 ms. `sort=rising` already
   had this shape from `(deprecated, star_velocity_7d, popularity)` — 25 rows,
   0.5 ms — which is the comparison that made the gap obvious.
2. **Give `catalogStats()` a covering index** (`0013`) so `/catalog/version`
   does not heap-scan.
3. **Run `PRAGMA optimize` after every schema change**, per Cloudflare's index
   guidance: it runs `ANALYZE` so the planner can pick the new index.
4. **Keep caches on the success path only.** Facet DTOs in KV (60s) and the
   home rails in KV (60s) are both documented, pre-existing patterns. Neither
   stores a failure.

## Consequences

An overloaded D1 now produces an honest 500 instead of a plausible-looking
empty page. That is the intended trade: a visible failure is diagnosable, and
the rows-read numbers above are the thing to fix when it happens.

Reads got cheap enough that the symptom mostly stopped appearing: the
aggregations went from ~8,700-11,000 runs/hour at 53k rows each to tens of runs
at index cost.

## Alternatives considered

- **Cache the failure (the superseded ADR).** Rejected: forbidden by
  `AGENTS.md`, and it served stale empty pages long after recovery.
- **Split `readme_markdown` into its own table.** The 494 MB database suggested
  ~45 KB rows. Measuring said otherwise: `readme_markdown` averages 5.6 KB
  (61.9 MB total), and most of the 494 MB is `artifact_readme_translations`
  (73,601 rows, 89 MB of translated Markdown) plus FTS and metrics tables. The
  wide-row theory was wrong, so the schema change was not justified.
- **Disable the cron triggers.** Rejected on evidence: writes were ~30k
  rows/day against ~39 billion rows read. The load was request-driven.

## References

- [`../backend/database.md`](../backend/database.md) — catalog columns and covering indexes.
- [`adr-0006-locale-gated-fts-search.md`](adr-0006-locale-gated-fts-search.md) — the `%LIKE%` rollback path that must not carry crawler traffic.
