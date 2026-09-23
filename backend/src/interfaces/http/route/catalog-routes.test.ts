import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { Artifact } from '../../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../../domain/artifact/artifact-repository.js'
import { npmSource } from '../../../domain/artifact/source-ref.js'
import type { CatalogSnapshotStore } from '../../../application/port/catalog-snapshot-store.js'
import type { CatalogSnapshotDto } from '../../../application/use-case/get-catalog-snapshot.js'
import { GetCatalogSnapshot } from '../../../application/use-case/get-catalog-snapshot.js'
import type { Container } from '../../../infrastructure/container.js'
import type { HubBindings } from '../app.js'
import { catalogRoutes } from './catalog-routes.js'

const changedAt = new Date('2025-06-01T00:00:00.000Z')

function testContainer() {
  const rows = [
    Artifact.create({
      id: 'dsh-alpha',
      kind: 'bundle',
      displayName: 'dsh-alpha',
      summary: 'A bundle.',
      source: npmSource('dsh-alpha', '1.0.0'),
      payload: { kind: 'bundle', requiresBuild: false },
      updatedAt: changedAt,
    }),
  ]
  const artifacts = {
    listForSnapshot: async () => rows,
    catalogStats: async () => ({
      artifactCount: rows.length,
      maxUpdatedAtMs: changedAt.getTime(),
      installs: 0,
      stars: 0,
      downloads: 0,
    }),
  } as unknown as ArtifactRepository
  const entries = new Map<string, string>()
  const store: CatalogSnapshotStore = {
    read: async (dataVersion) => entries.get(dataVersion),
    write: async (dataVersion, body) => {
      entries.set(dataVersion, body)
    },
  }
  return {
    useCases: { getCatalogSnapshot: new GetCatalogSnapshot(artifacts, store) },
  } as unknown as Container
}

function testApp() {
  const app = new Hono<HubBindings>()
  app.use('*', async (context, next) => {
    context.set('container', testContainer())
    await next()
  })
  app.route('/api/v1', catalogRoutes())
  return app
}

describe('catalog snapshot endpoints', () => {
  it('serves the full catalog with an ETag and shared-cache directives', async () => {
    const response = await testApp().request('/api/v1/catalog/snapshot')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    const etag = response.headers.get('ETag')
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)

    const body = (await response.json()) as CatalogSnapshotDto
    expect(body.artifacts.map((row) => row.id)).toEqual(['dsh-alpha'])
    expect(`"${body.dataVersion}"`).toBe(etag)
  })

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const app = testApp()
    const first = await app.request('/api/v1/catalog/snapshot')
    const etag = first.headers.get('ETag')
    expect(etag).not.toBeNull()

    const second = await app.request('/api/v1/catalog/snapshot', {
      headers: { 'If-None-Match': etag ?? '' },
    })

    expect(second.status).toBe(304)
    expect(second.headers.get('ETag')).toBe(etag)
    expect(await second.text()).toBe('')
  })

  it('keeps the ETag stable across identical catalogs', async () => {
    const app = testApp()
    const first = await app.request('/api/v1/catalog/snapshot')
    const second = await app.request('/api/v1/catalog/snapshot')

    expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'))
  })

  it('polls the version without downloading the catalog', async () => {
    const response = await testApp().request('/api/v1/catalog/version')

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.artifactCount).toBe(1)
    expect(body.generatedAt).toBe(changedAt.toISOString())
    expect(body.dataVersion).toMatch(/^[0-9a-f]{64}$/)
  })
})
