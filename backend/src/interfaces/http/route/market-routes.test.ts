import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { Artifact } from '../../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../../domain/artifact/artifact-repository.js'
import { githubSource, npmSource } from '../../../domain/artifact/source-ref.js'
import type { Container } from '../../../infrastructure/container.js'
import { GetMarketIndex } from '../../../application/use-case/get-market-index.js'
import type { HubBindings } from '../app.js'
import { catalogRoutes } from './catalog-routes.js'

const FULL_COMMIT = 'b'.repeat(40)

function artifact(
  id: string,
  options: {
    readonly origin?: 'npm' | 'github'
    readonly commit?: string
    readonly kind?: 'bundle' | 'skill'
  } = {},
): Artifact {
  const origin = options.origin ?? 'npm'
  const kind = options.kind ?? 'bundle'
  return Artifact.create({
    id,
    kind,
    displayName: id,
    summary: 'A bundle.',
    source:
      origin === 'npm'
        ? npmSource(id, '2.0.0')
        : githubSource({ owner: 'acme', repo: id }),
    payload:
      kind === 'skill'
        ? {
            kind: 'skill',
            skillName: id,
            layout: 'flat',
            files: [{ path: 'SKILL.md', downloadUrl: 'https://dsh.fish/s.md' }],
          }
        : { kind: 'bundle', requiresBuild: false },
    updatedAt: new Date('2025-06-01T00:00:00.000Z'),
    ...(options.commit === undefined ? {} : { sourceCommitSha: options.commit }),
  })
}

function testApp(rows: Artifact[]) {
  const artifacts = {
    listForSnapshot: async () => rows,
  } as unknown as ArtifactRepository
  const container = {
    useCases: { getMarketIndex: new GetMarketIndex(artifacts) },
  } as unknown as Container

  const app = new Hono<HubBindings>()
  app.use('*', async (context, next) => {
    context.set('container', container)
    await next()
  })
  app.route('/api/v1', catalogRoutes())
  return app
}

describe('GET /api/v1/market/index.json', () => {
  it('serves a format-1 index a DSH client can parse', async () => {
    const response = await testApp([
      artifact('dsh-postgres-mcp'),
      artifact('pinned', { origin: 'github', commit: FULL_COMMIT }),
    ]).request('/api/v1/market/index.json')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    // The market reads indexes on a schedule; a short public cache keeps a
    // popular index off the Worker's back without going stale for long.
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')

    const body = (await response.json()) as {
      format: number
      title: { en: string }
      metadata: { categories: Record<string, unknown>; labels: unknown; sortKeys: unknown }
      plugins: {
        name: string
        versions: { version: string; source: { type: string } }[]
      }[]
    }

    expect(body.format).toBe(1)
    expect(body.title.en).toBe('dsh.fish')
    // The format requires all three declaration groups, even when empty.
    expect(body.metadata.labels).toEqual({})
    expect(body.metadata.sortKeys).toEqual({})

    expect(body.plugins.map((plugin) => plugin.name)).toEqual(['dsh-postgres-mcp', 'pinned'])
    expect(body.plugins[0]?.versions[0]?.source.type).toBe('npm')
    expect(body.plugins[1]?.versions[0]?.source.type).toBe('git')
  })

  it('excludes artifacts the market format cannot install', async () => {
    const response = await testApp([
      artifact('installable'),
      artifact('a-skill', { kind: 'skill' }),
      artifact('unpinned', { origin: 'github' }),
    ]).request('/api/v1/market/index.json')

    const body = (await response.json()) as { plugins: { name: string }[] }
    expect(body.plugins.map((plugin) => plugin.name)).toEqual(['installable'])
  })

  it('answers an empty catalog with an empty plugin list', async () => {
    const response = await testApp([]).request('/api/v1/market/index.json')
    const body = (await response.json()) as { plugins: unknown[] }
    expect(response.status).toBe(200)
    expect(body.plugins).toEqual([])
  })
})
