# Operations

This section covers how the project is run, built, deployed, and monitored.

## Documents

- [`local-dev.md`](local-dev.md) — local development setup.
- [`deployment.md`](deployment.md) — Worker deployment and CLI publish.

## Environment

Fill in concrete environment requirements here once the technology stack is chosen:

- Runtime version: `__RUNTIME_VERSION__`
- Required environment variables: `DATABASE_URL`, `PORT`, `LOG_LEVEL`, etc.
- Local services: database, cache, message broker.

## Commands

Define the standard commands for this project. Placeholders:

```sh
# Install dependencies
__INSTALL_COMMAND__

# Run tests
__TEST_COMMAND__

# Run type checks
__TYPECHECK_COMMAND__

# Start the backend
__START_BACKEND__

# Start the frontend
__START_FRONTEND__
```

Replace these with real commands when the stack is selected.

## SEO/search rollout

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
