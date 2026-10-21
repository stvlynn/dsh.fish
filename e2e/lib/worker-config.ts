import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'

export function isolatedWorkerConfig(source: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const parsed: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid production Worker configuration for E2E isolation')
  const config = { ...(parsed as Record<string, unknown>) }
  const vars = config.vars
  if (vars !== undefined && (vars === null || typeof vars !== 'object' || Array.isArray(vars)))
    throw new Error('Invalid Worker vars for E2E isolation')
  delete config.hyperdrive
  config.vars = {
    ...(vars as Record<string, unknown> | undefined),
    STORAGE_BACKEND: 'd1',
    CATALOG_SEARCH_PAUSED: 'false',
    CATALOG_WRITES_PAUSED: 'false',
    CATALOG_CRON_PAUSED: 'true',
  }
  return config
}

export function prepareE2eWorkerConfig(root: string): string {
  const frontend = resolve(root, 'frontend')
  // Preserve relative binding paths by generating beside the original configuration.
  const path = resolve(frontend, '.generated-e2e.wrangler.jsonc')
  const config = isolatedWorkerConfig(readFileSync(resolve(frontend, 'wrangler.jsonc'), 'utf8'))
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  return path
}
