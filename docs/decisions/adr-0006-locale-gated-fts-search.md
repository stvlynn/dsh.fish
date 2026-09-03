# ADR 0006: Locale-gated FTS search

## Status

Accepted.

## Context

The catalog searched a lowercased concatenation with `%LIKE%`, advertised every
artifact in every locale, and had no stable user-intent taxonomy. This weakened
query relevance and let translated shells enter the index before their artifact
content was current.

## Decision

- Keep broad categories and add six curated, multilingual intent topics.
- Store exportable search documents per artifact and locale, mirrored into an
  external-content D1 FTS5 table by triggers.
- Treat FTS as derived state: restore the regular table, then rebuild FTS.
- Require current summary and optional README source hashes before a locale is
  exposed in artifact metadata or sitemaps.
- Roll out FTS and locale gating independently with `CATALOG_FTS_SEARCH` and
  `SEO_LOCALE_GATING`, both defaulting off.

## Consequences

Search understands Unicode-normalized topic vocabulary and can use FTS ranking,
while short queries retain a predictable fallback. Translation backfill also
refreshes hashes and search projections. Enabling the locale gate reduces URL
count until translation coverage catches up; that reduction is intentional.

Production search is on (`CATALOG_FTS_SEARCH=true` in `frontend/wrangler.jsonc`).
The flag remains independently reversible. `%LIKE%` on search documents is the
rollback path and must not stay on for crawler traffic: a leading wildcard is a
full D1 scan.
