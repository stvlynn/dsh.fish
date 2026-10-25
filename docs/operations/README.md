# Operations

This section covers how the project is run, built, deployed, and monitored.

## Documents

- [`local-dev.md`](local-dev.md) — local development setup.
- [`deployment.md`](deployment.md) — Worker deployment and CLI publish.
- [`mysql-migration.md`](mysql-migration.md) — TencentDB MySQL rehearsal results and cutover requirements.

- [`vps-deployment.md`](vps-deployment.md) — Node/Redis VPS runtime, validation, and rollback.

## Environment

Production uses Node 24, private TencentDB MySQL and authenticated Redis on the
Singapore VPS. Runtime configuration and release files are listed in the
[VPS runbook](../../deploy/docker/README.md).

## Commands

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build:vps
DSH_RELEASE=<new-tag> pnpm run deploy
```

`pnpm run dev` retains the local Worker adapter and isolated D1 fixture workflow.
Worker production deployment/build triggers are retired.

## Retained Worker SEO/search rollout

1. Apply D1 migration `0009_flimsy_machine_man` with both rollout variables
   false.
2. Let the localization backfill traverse the full catalog; it refreshes source
   hashes, topics and search documents as well as translations.
3. Compare document/topic counts with non-deprecated artifact counts and test
   representative Latin and CJK queries.
4. `CATALOG_FTS_SEARCH=true` is the production default in
   `frontend/wrangler.jsonc`. Revert the variable if D1 errors or query quality
   regress. Apply `0010_artifact_facet_covering_indexes` so home/browse facet
   counts do not scan `readme_markdown`. Unique `/browse?q=` crawls miss the
   HTML cache; the Worker sheds known scrape ASNs with 429, unique `q=` searches
   share a 10/minute KV budget, and facet counts are reused from KV for 60s.
   Apply `0011_artifact_recent_covering_index` so home `sort=recent` does not
   scan `readme_markdown`.
5. Check current locale coverage, then set `SEO_LOCALE_GATING=true`; this switch
   is independently reversible.
6. Purge the edge cache, sample the sitemap files, and submit the sitemap index
   through verified webmaster properties.
