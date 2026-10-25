# VPS deployment

Production runs Node 24 SSR/API, an independent Redis instance, and an Nginx
admission proxy on the Singapore Lighthouse host. Caddy terminates origin TLS;
Cloudflare provides proxied DNS/CDN/WAF. MySQL stays on TencentDB's private
network. This stack does not require Workers, D1, Hyperdrive, or Durable Objects.

## Build

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build:vps
docker build -f deploy/docker/Dockerfile -t dsh-fish:<release> .
```

For subsequent releases, `DSH_RELEASE=<new-tag> pnpm run deploy` builds locally,
transfers only the release bundle, builds an immutable VPS image, preserves hashed
assets, waits for health and reloads Nginx. A failed candidate restores the previous
image and proxy configuration. `DSH_VPS_HOST` overrides the default production SSH
host. Run the quality gate before deployment. `pnpm run deploy:worker` is a retained
adapter command and must not target production.

The production bundle shares request orchestration and translation processing
with the retained Worker adapter. Node owns a six-connection MySQL pool for the
process lifetime. Request and job containers borrow it; graceful shutdown drains
HTTP, streams, background tasks and queue workers before closing clients.

## Runtime files

Keep these outside Git, in a directory accessible only to the operator:

- `runtime.env`: `PUBLIC_BASE_URL`, unchanged `BETTER_AUTH_SECRET`, GitHub OAuth
  credentials, private `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/
  `MYSQL_DATABASE`, authenticated `REDIS_URL`, and explicit feature/pause flags.
- `redis.conf`: password, AOF (`appendfsync everysec`), bounded memory, and
  `maxmemory-policy noeviction`. Compose mounts it as `redis_config`.
- `.env`: `DSH_IMAGE=dsh-fish:<release>` selecting an immutable release tag.
- `nginx.conf` and `compose.yaml` from this directory.

For this host, the external edge network is `astrafoundry-site_default`.
`origin` publishes only loopback port 3090. Redis and Node have no public host
ports. The existing Caddy proxy uses `dsh-origin:8080`, a Cloudflare Origin CA
certificate and an origin source-IP allowlist. Use Full (strict) TLS at Cloudflare.
Keep the origin certificate private key outside images and the repository.

## Start and validate

```sh
docker compose config --quiet
docker compose up -d --wait
curl --fail http://127.0.0.1:3090/api/ready
```

`/api/health` is liveness. `/api/ready` verifies MySQL and Redis. Before routing
traffic, test home/browse, Latin/CJK search, locale pages, detail, sitemap/docs,
PNG generation, anonymous and signed sessions, OAuth initialization/device flow,
and streaming. Redis and admission tests also exercise real atomic Lua and TTLs
against an isolated instance; no production database fixtures are necessary.

Nginx limits requests and connections before Node. Anonymous successful catalog
list/search JSON is cached at the origin for 15 seconds; cookie/Bearer traffic,
auth, errors, and streaming bypass this cache. This bounds repeated popular
searches without caching personalized responses. Redis atomically bounds costly
catalog queries across replicas. Basic catalog pages do not acquire that lease.
Only Cloudflare/host-local traffic reaches Caddy's dsh.fish origin route; client
identity headers must never be trusted on an unrestricted public origin.

## Jobs and recovery

BullMQ persists job schedules, retry state and deduplication in Redis AOF. A single
maintenance consumer serializes ingestion, reclassification and facet refresh;
a single localization consumer bounds model concurrency. Completed/failed job
retention is bounded. Queue errors are logged without job bodies or credentials.

`CATALOG_CRON_PAUSED=false` explicitly resumes maintenance. Set
`TRANSLATION_ENABLED=true` only after a successful probe of OpenCode Go's pinned
`beam-free` model. Its endpoint is
`https://opencode.ai/inference/go/openai/v1/chat/completions`, with the required
`OPENCODE_GO_API_KEY` bearer credential and a 90-second timeout. Requests identify
the client as `dsh-fish-localization/1.0` and send a stable `x-opencode-session`
for each translation job, including retries. Authentication/quota failures remain
explicit and never select another model. Consumption is enabled after credential
renewal and successful queue/MySQL/public-API acceptance. For future credential
rotation, create a replacement key in OpenCode Console, update the host's
runtime.env, probe it, then recreate the app. Signing in does not renew an expired
key. Maintenance remains paused independently; enabling translation does not
start a bulk backfill.

MySQL holds translation hashes, status, completed bodies and resumable chunks.
The Node backfill resubmits pending work using these authoritative records;
queue payloads are not a second source of catalog truth. Preserve crawler
cursors during the cutover. A recovery pass starts from the beginning rather
than treating the old durable queue's pending payloads as completed work.

## Rollback and backups

The app mounts `/opt/dsh-fish/shared/assets` read-only. Before starting a new
image, copy its hashed client assets into this directory without deleting older
files. Cached HTML and open tabs can then load their release's immutable assets.
Retain the previous image and client assets until acceptance. Change `DSH_IMAGE`
back and recreate `app` to roll back code while keeping the same writable MySQL
and Redis state. Do not switch back to frozen D1 after MySQL writes.

Back up Redis's volume and runtime configuration with host-restricted permissions,
and use TencentDB backups for the authoritative data. AOF every-second fsync can
lose approximately one second on a host failure; derived translation work can be
reconstructed from MySQL. Never delete the Redis volume during an update.
Configure rotated Docker logs and monitor disk, memory, queue depth and readiness.
