import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import { D1ArtifactRepository } from './d1-artifact-repository.js'
import { ListCatalogFacets } from '../../application/use-case/list-catalog-facets.js'
import * as schema from './schema.js'

/** Minimal D1Database over node:sqlite so the real repository + real migrations run unmodified. */
function d1Shim(sqlite: DatabaseSync): D1Database {
  const prepare = (query: string) => {
    let params: unknown[] = []
    const stmt = {
      bind: (...values: unknown[]) => { params = values; return stmt },
      all: async () => ({ results: sqlite.prepare(query).all(...(params as never[])) as unknown[], success: true, meta: {} }),
      raw: async () => { const statement = sqlite.prepare(query); statement.setReturnArrays(true); return statement.all(...(params as never[])) as unknown[] },
      run: async () => { sqlite.prepare(query).run(...(params as never[])); return { results: [], success: true, meta: {} } },
      first: async () => (sqlite.prepare(query).get(...(params as never[])) ?? null),
    }
    return stmt
  }
  return {
    prepare,
    batch: async (statements: { all: () => Promise<unknown> }[]) => {
      sqlite.exec('BEGIN')
      try { const out = []; for (const s of statements) out.push(await s.all()); sqlite.exec('COMMIT'); return out }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
    exec: async (q: string) => { sqlite.exec(q); return { count: 1, duration: 0 } },
  } as unknown as D1Database
}

function migrated(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:')
  const root = resolve(__dirname, '../../../migrations')
  for (const file of readdirSync(root).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(resolve(root, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement)
    }
  }
  return sqlite
}

function seed(sqlite: DatabaseSync): void {
  const art = sqlite.prepare("insert into artifacts (id, kind, display_name, summary, source, source_origin, payload, keywords, categories, published_at, updated_at, indexed_at, deprecated) values (?, ?, 'n', 's', '{}', 'github', '{}', '[]', '[]', 1, 1, 1, ?)")
  const cat = sqlite.prepare('insert into artifact_categories (artifact_id, category_id) values (?, ?)')
  const top = sqlite.prepare('insert into artifact_topics (artifact_id, topic_id) values (?, ?)')
  art.run('a', 'skill', 0); cat.run('a', 'dev'); cat.run('a', 'tools'); top.run('a', 'memory')
  art.run('b', 'skill', 0); cat.run('b', 'dev')
  art.run('c', 'bundle', 0); cat.run('c', 'tools'); top.run('c', 'memory'); top.run('c', 'web-search')
  art.run('gone', 'skill', 1); cat.run('gone', 'dev'); top.run('gone', 'memory')
}

describe('catalog facet counts on a real migrated schema', () => {
  it('the migration backfill populates the table, so a migrated database is never in the unrefreshed state', async () => {
    const sqlite = migrated()
    const repository = new D1ArtifactRepository(drizzle(d1Shim(sqlite), { schema }))
    expect(await repository.readFacetCounts()).toBeDefined()
  })

  it('reports a wiped table as undefined, and the use case fails loudly instead of rendering zeroes', async () => {
    const sqlite = migrated()
    sqlite.exec('delete from catalog_facet_counts')
    const repository = new D1ArtifactRepository(drizzle(d1Shim(sqlite), { schema }))
    expect(await repository.readFacetCounts()).toBeUndefined()
    await expect(new ListCatalogFacets(repository).execute()).rejects.toThrow(/never been refreshed/)
  })

  it('refresh recomputes live-only counts and read returns them', async () => {
    const sqlite = migrated(); seed(sqlite)
    const repository = new D1ArtifactRepository(drizzle(d1Shim(sqlite), { schema }))
    await repository.refreshFacetCounts()
    const counts = await repository.readFacetCounts()
    expect(counts?.kinds).toEqual(expect.arrayContaining([{ kind: 'skill', count: 2 }, { kind: 'bundle', count: 1 }]))
    expect(counts?.categories).toEqual(expect.arrayContaining([{ id: 'dev', count: 2 }, { id: 'tools', count: 2 }]))
    expect(counts?.topics).toEqual(expect.arrayContaining([{ id: 'memory', count: 2 }, { id: 'web-search', count: 1 }]))
  })

  it('refresh is idempotent and picks up catalog changes', async () => {
    const sqlite = migrated(); seed(sqlite)
    const repository = new D1ArtifactRepository(drizzle(d1Shim(sqlite), { schema }))
    await repository.refreshFacetCounts()
    await repository.refreshFacetCounts()
    expect(sqlite.prepare('select count(*) c from catalog_facet_counts').get()).toEqual({ c: 2 + 2 + 2 + 1 })
    sqlite.exec("update artifacts set deprecated = 1 where id = 'b'")
    await repository.refreshFacetCounts()
    expect((await repository.readFacetCounts())?.kinds).toEqual(expect.arrayContaining([{ kind: 'skill', count: 1 }]))
  })

  it('an empty live catalog is a valid refreshed state, not never-refreshed', async () => {
    const sqlite = migrated()
    const repository = new D1ArtifactRepository(drizzle(d1Shim(sqlite), { schema }))
    await repository.refreshFacetCounts()
    const counts = await repository.readFacetCounts()
    expect(counts).toBeDefined()
    expect(counts?.kinds).toEqual([])
  })

  it('the 0015 migration backfill matches a fresh refresh', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const root = resolve(__dirname, '../../../migrations')
    const files = readdirSync(root).filter((f) => f.endsWith('.sql')).sort()
    const apply = (file: string) => { for (const s of readFileSync(resolve(root, file), 'utf8').split('--> statement-breakpoint')) if (s.trim()) sqlite.exec(s) }
    for (const file of files.filter((f) => !f.startsWith('0015'))) apply(file)
    seed(sqlite)
    apply(files.find((f) => f.startsWith('0015'))!)
    const backfilled = sqlite.prepare('select dimension, facet_id, count from catalog_facet_counts order by 1, 2').all()
    const repository = new D1ArtifactRepository(drizzle(d1Shim(sqlite), { schema }))
    await repository.refreshFacetCounts()
    const refreshed = sqlite.prepare('select dimension, facet_id, count from catalog_facet_counts order by 1, 2').all()
    expect(backfilled).toEqual(refreshed)
  })
})
