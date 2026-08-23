import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from './app.js'
import type { HubEnv } from '../../infrastructure/config/env.js'

/**
 * Routing contract for the API.
 *
 * The Worker forwards requests with their original path (`/api/v1/facets`),
 * so the router has to be mounted at that same prefix. Getting this wrong is
 * silent and total — every endpoint 404s while the site itself still renders —
 * so the prefix is pinned here rather than left to be noticed in a browser.
 */

// Only the fields the routing path reads. The catalog handler is expected to
// fail without a real D1 binding — reaching it at all is what is asserted.
const env = {
  DB: {} as never,
  KV: {} as never,
  ASSETS: {} as never,
  README_I18N_AGENT: {} as never,
  OPENCODE_GO_API_KEY: 'test-key',
  PUBLIC_BASE_URL: 'https://dsh.fish',
  BETTER_AUTH_SECRET: 'test-secret',
} satisfies HubEnv

function call(path: string) {
  return createApiApp({
    readmeLocalization: () => ({ schedule: async () => {} }),
  }).fetch(new Request(`https://dsh.fish${path}`), env)
}

describe('API routing', () => {
  it('serves health under the /api prefix the Worker forwards', async () => {
    const response = await call('/api/health')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('does not answer the unprefixed path', async () => {
    // The Worker only routes `/api/*` here; anything else belongs to the SSR
    // handler, so a bare `/health` must not be claimed.
    expect((await call('/health')).status).toBe(404)
  })

  it('returns the JSON error envelope for an unmatched API path', async () => {
    const response = await call('/api/v1/does-not-exist')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/json/)
    const body = (await response.json()) as {
      error: { code: string; message: string; hint: string }
    }
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toMatch(/route/i)
    expect(body.error.hint).toMatch(/openapi\.json/)
    expect(body.error.hint).toMatch(/llms\.txt|\/docs\/developers/)
  })

  it('exposes the versioned catalog namespace', async () => {
    // Reaching the handler is what matters: with no D1 binding in this test the
    // read fails, and that failure must arrive as the standard error envelope
    // rather than as an unrouted 404.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await call('/api/v1/facets')
    expect(response.status).not.toBe(404)
    consoleError.mockRestore()
  })

  it('publishes the scoring model without touching the database', async () => {
    // The formula is a constant, so this endpoint must answer even with no D1
    // binding — it is the public contract every score on the site cites.
    const response = await call('/api/v1/scoring')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { weights: Record<string, number> }
    expect(body).toMatchObject({
      weights: { popularity: 0.4, maintenance: 0.3, quality: 0.3 },
      grades: { S: 85, A: 70, B: 50 },
    })
    const weightSum = Object.values(body.weights).reduce((total, weight) => total + weight, 0)
    expect(weightSum).toBeCloseTo(1)
  })
})
