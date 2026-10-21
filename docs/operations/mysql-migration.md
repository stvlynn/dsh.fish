# MySQL cutover runbook

## Current state and acceptance gates

Production now uses TencentDB MySQL through Hyperdrive and the verified-TLS
gateway. Deployment `93d5077f-7de1-403a-b608-e2f901f1362e` selects
`STORAGE_BACKEND=mysql`, `CATALOG_SEARCH_PAUSED=false`, and
`CATALOG_WRITES_PAUSED=false`. `CATALOG_CRON_PAUSED=true` is retained while
post-cutover connection-path latency is investigated; scheduled ingestion and
backfill are not claimed restored. The raw TencentDB public endpoint is closed.

The final frozen 17-table snapshot contained 314,962 rows. Every table passed
primary-key-ordered counts and canonical content SHA-256 checks before traffic
was reopened. The frozen export was byte-identical to the verified preflight
export (SHA-256 `8ae1754142c8fb8dfd3671d24670c1e3fabd181249665c8da5eefd861675bd45`),
and the D1 time-travel bookmark remained unchanged. The final guarded delta
therefore had zero inserts, updates or deletes. Preserve D1 as a frozen source,
not a writable fallback.

Verified preparation:

- The isolated `dsh_fish_validation` schema accepted all 52 initial DDL statements.
- Local verified-TLS connectivity succeeded. Seven isolated real-MySQL repository
  tests passed, covering transactions/rollback, concurrent writes, NULL, JSON,
  epoch dates, NUL bytes, multilingual search, and related repositories.
- An independent read-only probe Worker returned `ok: true`, database
  `dsh_fish`, and 45 ms elapsed when requested over HTTPS from the gateway via
  SSH. The local machine could not reach its workers.dev URL because of a local
  TLS/network failure, not a Worker SQL failure. This probe is not a production
  application deployment or an authenticated production smoke test.
- Initial production schema migration completed, and the full 17-table preflight
  passed counts and canonical SHA-256 for 314,962 rows. Atomic server-side baseline
  seeding and complete baseline verification also passed.
- Five real isolated authentication tests passed after explicitly enabling
  database-backed MySQL sessions and verification records. The same KV binding
  and signing secret remain required. OAuth attempts interrupted by maintenance
  may need to be restarted; do not invalidate all existing session KV entries.

The earlier six-table public-catalog rehearsal omitted identity, ownership and
private records. Its row counts and digests do **not** establish readiness for
the full migration. The final report must cover every table listed below without
clearing ownership or excluding authentication data.

## Prepared network path

```text
Worker
  -> Hyperdrive 05c55f04e4cc44878f027160f009c4ae
  -> verified TLS gateway 43.160.219.124:13306
  -> Lighthouse lhins-k2tmvjoh / CCN ccn-6nh2r4g7
  -> private TCP 10.0.0.11:3306
  -> TencentDB cdb-g6s6uc6d / ap-singapore / dsh_fish
```

Hyperdrive uses `VERIFY_IDENTITY` with uploaded gateway CA resource
`5b7a5e5c-80b5-4566-a6e6-4e9e63aab3fe`, query caching disabled, and an origin
connection limit of 16 (increased from the initial 10 during acceptance). The gateway runs on the existing
Lighthouse instance as container `dsh-fish-mysql-gateway`, from
`/opt/dsh-fish/mysql-gateway`, UID 999, with restart policy `unless-stopped`.
Keep its certificate/private key and migration credentials outside the repository
with restricted permissions; never print credentials or private snapshots.

**The final private-network hop from the gateway to TencentDB is not TLS.**
This TencentDB edition does not support native TLS. TLS authenticates and
protects the client-to-gateway leg; CCN/private routing does not turn the final
hop into encrypted transport. Do not describe this as end-to-end TLS. This trust
boundary must remain explicit in the cutover record; an end-to-end TLS requirement
would instead require a database edition that supports native TLS.
Do not bypass gateway TLS or expose the database's private port publicly.

## Schema and complete transfer scope

The authoritative initial DDL is
[0001_initial.sql](../../backend/mysql-migrations/0001_initial.sql): 17 application
tables, 52 statements, InnoDB, `utf8mb4_0900_bin`, native JSON and BIGINT
**epoch milliseconds**, not MySQL timestamp conversion. Bounded indexed
identifiers retain their existing values. `submissions.source_key` is LONGTEXT
with a 191-character prefix index. The four-column ngram FULLTEXT index covers
`artifact_search_documents(display_name, summary, keywords, topics)`.

| Scope | Ordinary tables to export and verify |
| --- | --- |
| Catalog and ownership | `artifacts`, `artifact_categories`, `artifact_topics`, `artifact_search`, `artifact_search_documents`, `catalog_facet_counts` |
| Identity, OAuth, sessions and device grants | `users`, `accounts`, `sessions`, `verifications`, `device_codes` |
| Community and submission workflow | `artifact_reviews`, `submissions` |
| Metrics and localization | `artifact_metrics`, `artifact_readme_translations`, `artifact_summary_translations`, `artifact_readme_translation_chunks` |

Preserve `artifacts.owner_account_id`, user/account identifiers, OAuth tokens and
expiry values, session tokens, device authorization state, review creation times,
submission decisions, metric history, translation status/error/body/hash fields,
and resumable chunk identity/order. This is not a public projection.

D1 FTS virtual tables and their shadow tables are derived SQLite objects and
are excluded from the explicit-table export. MySQL search is derived from the
ordinary search document rows using its own ngram index; do not copy FTS5 objects.
The MySQL migration ledger is not an application table copied from D1.

## Prepare and rehearse without changing production

1. Review the migration DDL and current source schema together. Confirm all 17
   tables, column sets, primary keys, JSON validity, identifier bounds and
   foreign-key relationships. Prepare backups and restrict access to exports.
2. Verify gateway certificate identity/CA and the Hyperdrive probe from the
   Worker environment. Preserve the successful read-only probe evidence and
   repeat it if the gateway, certificate or binding changes.
3. Apply the initial migration only to an authorized empty target with
   [migrate-mysql.mjs](../../backend/scripts/migrate-mysql.mjs). Its
   `_mysql_migrations` ledger stores the SQL SHA-256 and completion flag.
   It refuses checksum changes, interrupted DDL and a nonempty initial target.
   MySQL DDL is not an all-or-nothing transaction: inspect and explicitly
   reconcile/recreate an interrupted target; do not mark its ledger complete.
4. Export all ordinary tables explicitly with Wrangler. A whole-database D1
   export can fail on FTS5. Restore the export with
   [restore-d1-export.py](../../backend/scripts/restore-d1-export.py); it refuses
   to overwrite a snapshot and runs SQLite foreign-key/integrity checks. NUL
   bytes are preserved by replacing the complete affected SQL string literal
   with `CAST(X'<UTF-8 hex>' AS TEXT)`, never by deleting characters.
5. Rehearse import and verification against an isolated target. Never run the
   repository fixtures against `dsh_fish`; use `dsh_fish_validation` and the
   [isolated integration procedure](../quality/testing.md#mysql-repository-validation).

Local migration tools read `MYSQL_MIGRATION_CONFIG` internally. The release
runner also accepts the seven `MYSQL_*` CI secrets directly, including an inline
PEM CA; see [build-time secret setup](deployment.md#production-build-time-mysql-secrets).
The runner discovers numbered SQL files, validates all applied checksums and
uses an advisory lock. `--production --check` reads history without schema or
ledger mutation. It uses a target-specific migration account, never database root. The test
process separately uses only its validation account, not administrative
credentials. Do not display either configuration file.

Example commands from the repository root, with already authorized config and
snapshot locations supplied by the operator:

```sh
MYSQL_MIGRATION_CONFIG="$MIGRATION_CONFIG" node backend/scripts/migrate-mysql.mjs
python3 backend/scripts/restore-d1-export.py "$D1_EXPORT" "$D1_SNAPSHOT"
MYSQL_MIGRATION_CONFIG="$MIGRATION_CONFIG" \
  python3 backend/scripts/transfer-mysql.py "$D1_SNAPSHOT" "$IMPORT_REPORT"
MYSQL_MIGRATION_CONFIG="$MIGRATION_CONFIG" \
  python3 backend/scripts/transfer-mysql.py "$D1_SNAPSHOT" "$VERIFY_REPORT" --verify-only
```

[transfer-mysql.py](../../backend/scripts/transfer-mysql.py) requires the completed
schema migration and refuses to import into application tables containing rows.
It loads `users` and `artifacts` before children, keeps foreign keys enabled,
checks exact column sets and stable primary keys, validates native JSON, and
compares per-table row counts and SHA-256 over primary-key-ordered canonical
JSON records. JSON key order is normalized for comparison; NULL, epoch values,
Unicode and NUL content remain meaningful. Reports are written with owner-only
permissions and must include all 17 tables.

Initial empty-target imports commit bounded batches. An interrupted import can leave committed
partial data: it is **not resumable by silently rerunning**, and a schema ledger
marked complete does not mean the data transfer is complete. Keep the frozen
source snapshot; inspect and explicitly reset/reconcile only the authorized
target before restarting. Do not promote a partial report or reuse a completed
backfill cursor with partial application data.

## Verified baseline and atomic final delta

To reduce the maintenance window, an unopened `dsh_fish` target may be seeded
from the fully verified `dsh_fish_validation` baseline using
[seed-mysql-baseline.py](../../backend/scripts/seed-mysql-baseline.py). The seed
requires matching completed schema ledgers and empty production application
tables; all `INSERT ... SELECT` operations are one InnoDB transaction. Verify
its contents against the original preflight snapshot before maintenance. Do not
run fixture tests on validation while seeding.

After the final frozen export, `transfer-mysql.py --baseline <preflight.sqlite>`
first checks the schema checksum, all column sets, ordered primary keys and every
target table SHA against the baseline. Only then does it delete children first,
update existing rows by their complete primary keys and insert new parent rows
before children. Secondary unique conflicts fail closed, never replace another
row identity. All delta changes and final 17-table verification share one
transaction; commit occurs only after every digest matches. A failure rolls back
the delta, and maintenance stays enabled. A commit/report ambiguity requires
independent `--verify-only`, not blind baseline replay.

The restoration tool preserves CR, CRLF, NUL, Unicode and SQL quote escaping;
it creates a private `0600` temporary SQLite file, checks all 17 tables, integrity
and foreign keys, and atomically publishes only the validated snapshot.

## Cutover sequence used

1. Keep `CATALOG_SEARCH_PAUSED` and `CATALOG_CRON_PAUSED` paused. Obtain explicit
   authorization for the final maintenance and import. Confirm the target is
   empty/migrated or exactly matches the verified baseline, backups are readable
   and all preflight gates have passed.
2. Enable `CATALOG_WRITES_PAUSED=true` on the D1-backed production Worker.
   This maintenance gate blocks **every non-health application request**, not
   just POST: GET counters, authentication/device/session operations and cached
   application responses must not bypass it. Only `/api/health` remains available.
   It also pauses scheduled work and defers Agent localization/retry work.
3. Allow already-running requests, streams, scheduled work and Agent operations
   to finish. Confirm no source writes remain before taking the final explicit
   17-table export. Restore/check it and record the frozen source counts/digests.
4. Transfer the frozen snapshot or apply the guarded atomic baseline delta through
   the verified gateway path. Require a
   complete 17-table comparison report and a successful independent verify-only
   pass. Preserve all ownership, auth, metrics, translations and chunks.
5. Keep the same KV binding, Better Auth secret, OAuth client and callback origin.
   After complete translation/chunk migration, retain the localization backfill
   cursor and existing durable queues. A cursor marked complete is unsafe if its
   corresponding rows were not fully migrated.
6. Set `STORAGE_BACKEND=mysql` and the prepared `HYPERDRIVE` binding while
   maintenance remains enabled. Deployment selected for MySQL runs
   [migrate-mysql.mjs](../../backend/scripts/migrate-mysql.mjs) after build and
   before Worker upload; it does not apply D1 migrations instead. The deployment
   process must receive the authorized `MYSQL_MIGRATION_CONFIG`.
7. Check the deployed health response and connectivity without reopening writes.
   MySQL rail, snapshot and edge cache keys use a `mysql-v1` namespace so old
   D1 catalog responses cannot certify the new backend. Auth secondary storage
   remains in the same KV namespace; do not clear it as a catalog cache purge.
8. Lift maintenance only after acceptance. Verify existing sessions, GitHub OAuth,
   device polling/authorization, ownership, submission/review writes, installs,
   translated detail/locales, snapshots and pagination. Enable search explicitly
   with `CATALOG_SEARCH_PAUSED=false` after representative Latin/CJK checks;
   enable scheduled work with `CATALOG_CRON_PAUSED=false` only after bounded-load
   checks. Unset pause variables do not enable search or cron.
9. Record the actual production cutover and final counts/digests. The completed
   snapshot acceptance and active deployment are recorded above.

MySQL clients are request/invocation scoped: pool limit 2, each transaction leases
an exclusive connection, and Hyperdrive manages origin pooling. Clients must
outlive response streams and registered background jobs, then be disposed;
Agent invocations open/dispose their own clients. Cron operations are serial to
bound write concurrency. Never cache a MySQL client across Worker invocations
or silently fall back to D1 after a MySQL connectivity failure.

## Acceptance and retained protection

Production home/browse, facets, catalog listings, authentication session endpoint
and sitemap returned 200 after reopening. Final production English and Chinese
searches returned 200 with 90 and 19 matches respectively; each returned two
requested items. A real Worker repository probe against
Hyperdrive found 90 Latin search matches, 19 Chinese search matches, 12,927 live
artifacts, and successfully loaded a detail and facet projection. The snapshot
contains 13,039 total artifacts, including deprecated rows. Seven repository and
five authentication TLS integration tests passed; OAuth interactive login itself
was not automated.

## Query-pressure incident and protection

Production first-byte delays reached facets 10.7 seconds, browse 17.2 seconds
and home 26.8 seconds, despite fast TCP/TLS. An isolated read-only Worker measured
SELECT 1/facet queries waiting 5–11 seconds while pool disposal took 0 ms. The
app account hit MySQL error 1226 (max_user_connections=20), and process-list
snapshots showed concurrent FULLTEXT count/page work.

Pausing production searches with the same application code reduced facets to
0.10 seconds, browse to 0.93 seconds and home to 2.1 seconds. The same Hyperdrive
probe then measured SELECTs in 7–18 ms and its search transaction in 54 ms. This
established expensive-query pressure/admission as the shared bottleneck, not
SSR rendering or an inherent multi-second MySQL query cost.

The old MySQL budget used KV get-plus-put on one global minute key. It was
non-atomic; runtime logs showed KV PUT failed: 429 Too Many Requests, escaping
before API handling as Worker error 1101. MySQL no longer uses that KV counter.
Legacy D1 retains its existing 10/minute KV budget.

CatalogQueryAdmission is a SQLite-backed Durable Object bound as
CAT_QUERY_ADMISSION. Expensive MySQL cache misses atomically reserve one global
lease and a maximum 120 successful admissions per minute. Excess work receives
429 with a short retry hint rather than waiting on the database. Plain home,
browse, facets, auth and static documents do not acquire the costly-query slot.
Text search and semantic filter routes are covered; known scrape ASN protection
remains. The lease persists across eviction and token-specific release cannot
clear another owner. Its 120-second expiry is crash recovery, not SQL cancellation:
a query running longer could outlive exclusion. Parallel loader siblings settle
before error propagation and lease release.

MySQL client pools now open lazily without unconditional SELECT 1 warm-up for
cached/static/anonymous-session paths. Real SQL failures still propagate without
D1 fallback. The app account cap is 32, providing bounded headroom above Hyperdrive
soft-origin limit 16 and below gateway capacity 40; this does not increase costly
query concurrency or grant additional database privileges.

Post-fix measured first-byte timings were facets 0.10–0.37 seconds, browse
0.18–0.42 seconds, home 1.6–1.8 seconds and anonymous session 0.7–0.9 seconds.
Search can return immediate 429 under sustained scraping instead of blocking
basic pages. A two-minute telemetry sample contained approximately 35,679
rejected responses; this is not an exact count of unique clients. Do not claim
unrestricted search availability or a load-test SLA. Cron remains paused;
interactive OAuth login was not automated.

## Failure handling and rollback boundary

Before any MySQL application writes are accepted, a failed readiness gate can
leave production on the frozen D1 source under maintenance while the authorized
operator repairs the target. Verify no MySQL writes occurred before any backend
reversion.

**After the first MySQL application write, do not flip `STORAGE_BACKEND` back to
D1.** The databases have diverged, including auth/session/device state and GET
side effects. Re-enable maintenance, drain work, and either forward-fix MySQL
or perform a reviewed reverse synchronization of every changed table/state
before serving from D1. A retained D1 binding or snapshot is not an automatic
rollback mechanism. Preserve failure evidence without exposing private data.
