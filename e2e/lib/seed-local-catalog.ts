import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { kitchenSinkReadme, KITCHEN_SINK_ARTIFACT_ID } from './kitchen-sink-readme.ts'
import { paginationFillerSql } from './pagination-fillers.ts'
import { sqlString } from './sql.ts'
import { E2E_ORIGIN } from './origin.ts'

/**
 * Apply catalogue migrations and the kitchen-sink readme to the local D1 that
 * the Vite Cloudflare plugin is already persisting. Must run *after* the
 * dev server has created that SQLite file — wrangler CLI and Vite share
 * `.wrangler/state/v3/d1`, but Vite will mint an empty Durable Object on
 * first boot if the file is not yet there.
 */
export function facetCountFixtureSql(migration: string): string {
  // Reuse the authoritative migration projections after fixture rows have been inserted.
  const statements = migration.split('--> statement-breakpoint').map((part) => part.trim())
  const inserts = statements.filter((part) => part.startsWith('INSERT INTO `catalog_facet_counts`'))
  if (inserts.length !== 4) throw new Error('Expected the four catalog facet projection statements')
  return ['DELETE FROM `catalog_facet_counts`;', ...inserts].join('\n')
}

export function seedLocalCatalog(root: string): void {
  const frontend = resolve(root, 'frontend')
  ensureDevVars(frontend)

  wrangler(frontend, 'd1 migrations apply dsh-fish-db --local')

  const combined = [
    readFileSync(resolve(root, 'backend/scripts/seed-local.sql'), 'utf8'),
    `UPDATE artifacts SET readme_markdown = ${sqlString(kitchenSinkReadme())} WHERE id = ${sqlString(KITCHEN_SINK_ARTIFACT_ID)};`,
    paginationFillerSql(),
    facetCountFixtureSql(
      readFileSync(resolve(root, 'backend/migrations/0015_catalog_facet_counts.sql'), 'utf8'),
    ),
    '',
  ].join('\n')
  const sqlPath = resolve(root, 'e2e/.generated-kitchen-sink.sql')
  writeFileSync(sqlPath, combined)
  // Vite already has the same SQLite file open. Wrangler loses the race unless
  // we wait out SQLITE_BUSY rather than aborting the whole suite.
  let last: unknown
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      wrangler(frontend, `d1 execute dsh-fish-db --local --file ${sqlPath}`)
      return
    } catch (error) {
      last = error
      execSync(`sleep ${attempt}`, { stdio: 'ignore' })
    }
  }
  throw last
}

/**
 * Write local Worker vars the e2e server must see at boot — notably
 * `ARTIFACT_ASK_ENABLED=true`. Call this *before* spawning Vite; Wrangler
 * reads `.dev.vars` once when the isolate starts.
 */
export function prepareE2eDevVars(root: string): void {
  ensureDevVars(resolve(root, 'frontend'))
}

function ensureDevVars(frontend: string): void {
  const path = resolve(frontend, '.dev.vars')
  const required: Record<string, string> = {
    PUBLIC_BASE_URL: E2E_ORIGIN,
    BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production',
    ARTIFACT_ASK_ENABLED: 'true',
    CATALOG_FTS_SEARCH: 'true',
    STORAGE_BACKEND: 'd1',
    CATALOG_SEARCH_PAUSED: 'false',
    CATALOG_WRITES_PAUSED: 'false',
    CATALOG_CRON_PAUSED: 'true',
  }
  let existing = ''
  try {
    existing = readFileSync(path, 'utf8')
  } catch {
    writeFileSync(
      path,
      Object.entries(required)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
    )
    return
  }
  let next = existing
  for (const [key, value] of Object.entries(required)) {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    if (pattern.test(next)) {
      // The ask feature and canonical origin must match this test run. Other
      // developer-owned values remain untouched.
      if (
        [
          'ARTIFACT_ASK_ENABLED',
          'PUBLIC_BASE_URL',
          'CATALOG_FTS_SEARCH',
          'STORAGE_BACKEND',
          'CATALOG_SEARCH_PAUSED',
          'CATALOG_WRITES_PAUSED',
          'CATALOG_CRON_PAUSED',
        ].includes(key)
      ) {
        next = next.replace(pattern, line)
      }
      continue
    }
    next = `${next.replace(/\s*$/, '\n')}${line}\n`
  }
  if (next !== existing) writeFileSync(path, next)
}

function wrangler(frontend: string, args: string): void {
  execSync(`pnpm exec wrangler --config .generated-e2e.wrangler.jsonc ${args}`, {
    cwd: frontend,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  })
}
