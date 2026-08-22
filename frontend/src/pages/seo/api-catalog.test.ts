import { describe, expect, it } from 'vitest'
import { apiCatalogDocument } from './api-catalog'

describe('apiCatalogDocument', () => {
  const document = JSON.parse(apiCatalogDocument('https://dsh.fish')) as {
    linkset: Record<string, unknown>[]
  }

  it('is a linkset anchored at the API and the origin', () => {
    expect(document.linkset).toHaveLength(2)
    expect(document.linkset[0]!.anchor).toBe('https://dsh.fish/api/v1')
    expect(document.linkset[1]!.anchor).toBe('https://dsh.fish')
  })

  it('points at the OpenAPI description, the docs, the health check and the snapshot', () => {
    const api = document.linkset[0] as Record<string, { href: string; type: string }[]>
    expect(api['service-desc']![0]).toEqual({
      href: 'https://dsh.fish/openapi.json',
      type: 'application/vnd.oai.openapi+json',
    })
    expect(api['service-doc']![0]).toEqual({ href: 'https://dsh.fish/docs', type: 'text/html' })
    expect(api['status']![0]).toEqual({
      href: 'https://dsh.fish/api/health',
      type: 'application/json',
    })

    const origin = document.linkset[1] as Record<string, { href: string; type: string }[]>
    expect(origin['describedby']).toEqual([
      {
        href: 'https://dsh.fish/api/v1/catalog/snapshot',
        type: 'application/json',
      },
      {
        href: 'https://dsh.fish/llms.txt',
        type: 'text/markdown',
      },
    ])
  })
})
