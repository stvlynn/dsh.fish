import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isolatedWorkerConfig } from './worker-config.ts'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { facetCountFixtureSql } from './seed-local-catalog.ts'

test('E2E uses local D1 without production Hyperdrive while preserving binding paths', () => {
  const config = isolatedWorkerConfig(
    JSON.stringify({
      main: './workers/app.ts',
      hyperdrive: [{ binding: 'HYPERDRIVE', id: 'production-reference' }],
      d1_databases: [{ binding: 'DB', migrations_dir: '../backend/migrations' }],
      vars: {
        STORAGE_BACKEND: 'mysql',
        PUBLIC_BASE_URL: 'https://fixture.invalid',
        CATALOG_WRITES_PAUSED: 'true',
      },
    }),
  )
  assert.equal('hyperdrive' in config, false)
  assert.equal(config.main, './workers/app.ts')
  assert.deepEqual(config.d1_databases, [
    { binding: 'DB', migrations_dir: '../backend/migrations' },
  ])
  assert.deepEqual(config.vars, {
    STORAGE_BACKEND: 'd1',
    PUBLIC_BASE_URL: 'https://fixture.invalid',
    CATALOG_SEARCH_PAUSED: 'false',
    CATALOG_WRITES_PAUSED: 'false',
    CATALOG_CRON_PAUSED: 'true',
  })
})
test('accepts JSONC comments and trailing commas', () => {
  assert.equal('hyperdrive' in isolatedWorkerConfig('{ /* fixture */ "hyperdrive": [], }'), false)
})
test('rejects malformed configuration and invalid vars', () => {
  for (const source of ['{broken', 'null', '[]', '{"vars": []}'])
    assert.throws(() => isolatedWorkerConfig(source))
})
test('fresh D1 fixture seeding rebuilds counts after inserting catalog rows', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(
      'CREATE TABLE artifacts (id TEXT, kind TEXT, deprecated INTEGER); CREATE TABLE artifact_categories (artifact_id TEXT, category_id TEXT); CREATE TABLE artifact_topics (artifact_id TEXT, topic_id TEXT);',
    )
    const migration = readFileSync(
      new URL('../../backend/migrations/0015_catalog_facet_counts.sql', import.meta.url),
      'utf8',
    )
    db.exec(migration)
    assert.equal(
      Number(
        db.prepare("SELECT count FROM catalog_facet_counts WHERE dimension='meta'").get()?.count,
      ),
      0,
    )
    db.exec(
      "INSERT INTO artifacts VALUES ('fixture', 'bundle', 0); INSERT INTO artifact_categories VALUES ('fixture', 'git'); INSERT INTO artifact_topics VALUES ('fixture', 'database');",
    )
    db.exec(facetCountFixtureSql(migration))
    assert.equal(
      Number(
        db
          .prepare(
            "SELECT count FROM catalog_facet_counts WHERE dimension='kind' AND facet_id='bundle'",
          )
          .get()?.count,
      ),
      1,
    )
    assert.equal(
      Number(
        db
          .prepare(
            "SELECT count FROM catalog_facet_counts WHERE dimension='category' AND facet_id='git'",
          )
          .get()?.count,
      ),
      1,
    )
    assert.equal(
      Number(
        db.prepare("SELECT count FROM catalog_facet_counts WHERE dimension='meta'").get()?.count,
      ),
      1,
    )
    db.exec(facetCountFixtureSql(migration))
    assert.equal(
      Number(db.prepare('SELECT count(*) AS rows FROM catalog_facet_counts').get()?.rows),
      4,
    )
  } finally {
    db.close()
  }
})
