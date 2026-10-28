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

## Catalog admission

Costly catalog requests — filtered `/browse`, `/api/v1/artifacts` with a filter,
and the facet landing pages — pass `frontend/server/admission.ts` before any SQL.
Three rules apply, in order:

1. **Facet bound.** A query combining more than 3 categories, 2 kinds or 2 topics
   is answered without touching the database: `/browse` returns a 404, the API a
   400 `INVALID_ARGUMENT`. These requests spend no admission capacity. The rule
   lives in `backend/src/domain/artifact/facet-bounds.ts` and is enforced again in
   `SearchArtifacts`, which every caller (browse, API, `hub_search`, CLI) uses.
2. **Two classes, one database slot.** `frontend/server/admission-class.ts` sorts
   a request into `interactive` (a loaded page fetching data — React Router
   `.data` navigation, the search palette — or any request with a cookie,
   authorization, or a Node client asking the API) or `document` (an anonymous
   top-level page load, `Sec-Fetch-Mode: navigate`). Each class owns a Redis-time
   token bucket of 1 request/s with burst 2. `interactive` may also spend idle
   `document` tokens; `document` can never spend `interactive` tokens. The total
   stays two queries per second, and one owner-specific lease still keeps database
   concurrency at one.
3. **Refusal.** A request with no tokens, or that cannot get the slot within
   160 ms, gets 429 with `Retry-After: 1`. The app's `http_request` log line adds
   `admission: "<class>;no-tokens|slot-busy"`; nginx strips the internal
   `X-Catalog-Admission` header before it leaves the origin.

The classification is a fairness hint, not a security boundary — any non-browser
client can send any header. What it guarantees is that anonymous page loads alone
cannot exhaust the capacity a reader on a loaded page uses.

### Why: the shared bucket failure

The previous design gave every costly request one global bucket (2/s). Production
traffic then showed a distributed crawler on `/browse`: about 400 addresses in 20
seconds, 1–4 requests each, all `navigate` page loads with real Chrome user
agents and no cookies. It followed the filter rail's `nofollow` links one toggle
at a time, sending 4–14 categories per URL, with 60% of URLs unique. It consumed
the whole bucket. In 10 minutes, 88% of requests got 429, and a person's search
was refused about nine times in ten. nginx's per-IP search limit never fired,
because no single address was busy.

### Local stress results

The same production code (old and new) ran over real Redis 7.4, behind the
production `nginx.conf`. A simulated one-core database stood behind it, using
measured production query latency (p50 61 ms, p99 878 ms). The load generator
replayed the captured scraper requests at 25 req/s, each from its own address,
alongside six simulated readers. Each reader loaded a page, then made data
fetches (navigation and palette) with think time. A 429 got one retry after a
second. Figures are the share of reader requests served; database concurrency
peaked at 1 in every run.

| Scenario (60 s)                                       | Old: page load / in-page | New: page load / in-page |
| ----------------------------------------------------- | ------------------------ | ------------------------ |
| No crawler                                            | 88% / 98%                | 93% / 100%               |
| Captured crawler replayed                             | 9% / 14%                 | 67% / 96%                |
| Crawler sends only within-bound combinations          | 0% / 11%                 | 13% / 74%                |
| …and also forges data-fetch headers                   | 9% / 16%                 | 13% / 18%                |

The facet bound turned 95% of the captured crawler's requests into free 404s.
The classes reserved capacity for in-page searches even against a crawler that
learned the bound. A crawler that also forges fetch metadata is out of the
application's reach: it shares the interactive bucket with readers again. Raising
the total rate did not help against it either; at 6/s the database was busy 51%
of the time and readers' page loads were still refused. The remedy for that
crawler is at the edge (below), not more capacity.

### Edge rules (operator, Cloudflare dashboard)

Cloudflare Free/Pro rate-limiting rules count per IP only, so they cannot see a
crawl spread across hundreds of addresses. Use these instead:

- **Bot Fight Mode** (Free) or **Super Bot Fight Mode** → challenge "definitely
  automated" (Pro).
- **Custom rule**, action *Managed Challenge*:
  `http.request.uri.path wildcard "*/browse" and http.request.uri.query ne "" and not http.cookie contains "better-auth"`.
  A person solves the challenge once per session; a headless crawler stops. A
  signed-in reader carries Better Auth's default session cookie
  (`__Secure-better-auth.session_token` over HTTPS) and is not challenged.
  `wildcard` is available on every plan; regex `matches` is not used because it
  needs Business. Test the expression in the dashboard's rule preview before
  enabling it.
- **Cache Rules**: keep "Sort query string" on, so equal selections share an edge
  cache key; the filter rail already writes parameters in one canonical order.

The exact public `/api/v1/artifacts` endpoint also uses a 15-second anonymous
origin cache. Cookie/authorization requests bypass it; other API endpoints and
SSE stay uncached. Public listing updates can therefore take 15 seconds to appear.
