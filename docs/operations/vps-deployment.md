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

### Origin cache and queueing

Costly reads are refused rather than queued. Admission allows about two per
second and a crawl sends ten times that, so a queue in front of the one-core
database would only grow until every waiter timed out. The origin nginx cache
keeps the refusal away from readers (`deploy/docker/nginx.conf`):

- `proxy_cache_lock on` coalesces concurrent misses on one URL into a single
  upstream request. This is the only queue, it is per key, and its timeout
  bounds it.
- `proxy_cache_background_update on` uses finite response-header windows:
  `stale-while-revalidate=30` and `stale-if-error=300`. Unconditional
  `proxy_cache_use_stale` flags stay off because they override those bounds.
  An expired public response can be served immediately while refreshing for
  30 seconds, or during an upstream failure/admission refusal for at most
  300 seconds after expiry. Continuous access does not extend either window;
  `inactive=10m` is idle eviction, not a freshness bound. Removals and policy
  changes therefore cannot resurrect an old cached success indefinitely.
  A never-cached URL still receives the original error.
- `proxy_cache_min_uses` stays at 1. Requiring two requests before storing was
  measured to be worse, because the first admitted response for a popular page
  is the scarce one. Over three runs, readers revisiting popular pages under the
  captured crawl got 80–91% with it versus 93–95% without. Crawler entries do not
  crowd the cache: production entries average ~140 KB, so 256 MB holds about
  1,800 pages, and over-bound unions are 404s and are never stored.

Measured with the same harness, adding a reader population that revisits eight
popular listings. Page lifetime was shortened to 10 s so expiry happened within
each 60 s run. Old is the previous app and nginx; new is the facet bound and
admission classes; queue is new plus the nginx changes above.

| Scenario | Revisited pages (old / new / queue) | Page loads | In-page |
| --- | --- | --- | --- |
| No crawler | 92% / 84% / 94% | 96% / 89% / 82% | 94% / 98% / 99% |
| Captured crawler | 10% / 71% / **90%** | 9% / 70% / 75% | 23% / 97% / 98% |
| Bound-aware crawler | 30% / 15% / 38% | 13% / 23% / 14% | 16% / 95% / 97% |

These tables record the initial prototype experiments. The final bounded stale
policy was re-tested with the same fixture and a fresh isolated Redis: captured
crawler replay yielded 99.0% in-page search success and 94.6% revisited-page
success (60 seconds, 25 crawler requests/s, six readers). The database in this
pressure harness is simulated from measured latency, not a real MySQL stress
benchmark. Seven real-Redis tests separately verify lease ownership/concurrency,
and eleven Docker/nginx checks verify cache coalescing, bounded age, removals,
privacy changes and upstream-error recovery.

Against a crawler that sends only unique within-bound URLs, the origin cache
helps little. A forged data-fetch client still competes in the interactive
share; the edge rule protects the observed document crawler, not all attacks.

### Edge rules (Cloudflare, zone `dsh.fish`, Free plan)

Cloudflare Free rate limiting counts per IP only, so it cannot see a crawl
spread across hundreds of addresses. Managed with the `cf` CLI:

- **Custom rule** in the zone's `http_request_firewall_custom` entrypoint
  (ruleset "dsh.fish edge protection"), action *Managed Challenge*:
  The versioned expression matches filtered `/browse` and `/browse/` in any
  locale, excluding requests that advertise Markdown and verified bots.
  - It protects document-like requests to those paths, including direct HTML
    HTTP clients. It is not a browser-authentication test and does not protect
    every possible catalog transport.
  - `/browse.data`, `/browse.md`, `/api/` and Markdown negotiation remain
    unchallenged. A challenge page breaks data fetches; preserving these
    boundaries keeps React Router, the palette, plugin and CLI working.
  - An arbitrary application cookie is not an exemption: Cloudflare cannot
    validate Better Auth sessions, and a fabricated cookie must not bypass
    protection. A browser that passes the challenge uses Cloudflare's own
    clearance for the configured challenge TTL (30 min).
  - The existing ASN block rule stays first.
- **Bot Fight Mode is not enabled.** It cannot be scoped or skipped by any rule,
  and Cloudflare documents that it may challenge API traffic. This site's API
  clients are non-browser HTTP clients: the `@dsh-fish/hub` plugin, the CLI,
  DeepSeek Harness fetching the market index, and agents reading `llms.txt`.
  Turning it on risks breaking them with no exemption available. Super Bot Fight
  Mode (Pro) supports skip rules and would be the way to add it.
- **Sort query string** for the cache key is not editable on the Free plan. The
  filter rail writes parameters in one canonical order instead.

The rule list is versioned in
[`deploy/cloudflare/http_request_firewall_custom.json`](../../deploy/cloudflare/http_request_firewall_custom.json).
That directory's README has the validate, apply and rollback commands.

The exact public `/api/v1/artifacts` endpoint also uses a 15-second anonymous
origin cache. Cookie/authorization requests bypass it; other API endpoints and
SSE stay uncached. Fresh catalog JSON lasts 15 seconds; failed refreshes may
reuse it for another 300 seconds. HTML/Markdown freshness is 300 seconds.
`pnpm run test:origin-cache` exercises the actual nginx image/configuration,
including concurrent miss coalescing, continuous access beyond stale expiry,
removals, credential isolation, formats and recovery.
