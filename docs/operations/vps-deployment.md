# VPS runtime

The Node deployment keeps SSR and API on one origin and reuses the existing
FSD routes, DDD use cases and MySQL repositories. Runtime boundaries are explicit:

| Concern                      | Node adapter                                                        |
| ---------------------------- | ------------------------------------------------------------------- |
| Request/SSR routing          | `frontend/server/handle-request.ts`, shared with Workers            |
| HTTP and streaming           | Hono Node server; bounded graceful shutdown                         |
| Persistence                  | One process-owned, six-connection private MySQL pool                |
| Cache, sessions, cursors     | `KeyValueStore` port with authenticated Redis                       |
| Ingestion/backfill schedules | Durable BullMQ schedules and one serial consumer                    |
| README localization          | Shared processor, idempotent hashes/chunks, BullMQ retries          |
| Model transport              | Pinned OpenCode Go Beam Free chat-completions endpoint with request timeout |
| Ada WebSocket                | Native Node WebSocket adapter                                       |
| Admission                    | Nginx before Node, atomic Redis lease before costly SQL             |
| Delivery                     | Cloudflare DNS/CDN/WAF → Caddy TLS → Nginx → Node                   |

See [deployment assets and runbook](../../deploy/docker/README.md) for build,
configuration, validation and rollback. Secrets and certificates are provisioned
outside Git and container images. Database credentials are restricted to the
VPS's private source address and application DML privileges.

Preserve the Better Auth signing secret and database-backed session records.
Cold secondary-cache reads still resolve through the authoritative MySQL store;
verify a signed cookie and bearer token against the candidate before cutover.
OAuth initialization uses the unchanged production callback URL.

Cloudflare version URLs and the default Worker endpoint must be disabled after
cutover, and Worker build triggers must not reclaim the production hostname.
Keep the frozen D1 source only as a backup, with no serving deployment attached.
The retired Worker is not a writable fallback.

The deployed origin is `43.160.219.124`; app state is under `/opt/dsh-fish`.
Cloudflare proxies its A record; `/api/ready` verifies MySQL and Redis. Four crawler
cursors were preserved. Ten isolated MySQL auth checks cover both runtime adapters,
including cold cookies, bearer tokens, device redemption and atomic verification.
The pinned model is OpenCode Go `beam-free`. After credential renewal, a direct
probe and a real catalog summary passed through BullMQ, the model, MySQL and the
public Chinese detail API. `TRANSLATION_ENABLED=true` enables one serial consumer;
the acceptance queue drained with no failed jobs. `CATALOG_CRON_PAUSED=true`
preserves the previous maintenance pause, so automatic ingestion and bulk
translation backfill remain paused. No model/provider fallback is configured.

The old Worker has no D1/Hyperdrive/model binding, no routes or URL entry points,
no schedules, and no build triggers. Its DO namespace data is retained for recovery;
its replacement classes do no model/database work and clear retired alarms.

Acceptance checks passed: public home/browse/locales/docs/blog/sitemaps, Latin/CJK
search, detail and dynamic PNG, and a complete public Ada SSE stream through
Cloudflare. Redis AOF restart, retry, TTL, owner-specific Lua lease and budget
checks passed against an isolated instance. D1 analytics returned no new groups
in the observed post-cutover window; analytics may lag. The repository quality
gate passed 903 tests, with opt-in MySQL checks run separately against the
validation schema. Interactive GitHub consent was not completed by the operator.

Costly catalog misses share one global lease and a Redis-time token bucket that
refills at two requests per second (burst two). Busy leases wait at most 160 ms;
exhausted tokens return 429 with `Retry-After: 1`. This preserves the previous
120/minute average while preventing a burst from disabling searches for the rest
of a minute. Anonymous cached documents bypass admission. Under sustained scraper
traffic, excess costly requests still receive 429 to protect the one-core database.

The exact public `/api/v1/artifacts` endpoint also uses a 15-second anonymous
origin cache. Cookie/authorization requests bypass it; other API endpoints and
SSE stay uncached. Public listing updates can therefore take 15 seconds to appear.
