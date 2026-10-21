import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isolatedWorkerConfig } from './worker-config.ts'

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
