import { expect, test, type APIResponse } from '@playwright/test'

/**
 * Agent-readiness doors: real 404s with a markdown recovery map, JSON API
 * errors, a typed OpenAPI Error schema, and the named developer index.
 */

function header(response: APIResponse, name: string): string {
  return (
    response
      .headersArray()
      .filter((entry) => entry.name.toLowerCase() === name)
      .map((entry) => entry.value)
      .join(', ') ||
    response.headers()[name.toLowerCase()] ||
    ''
  )
}

test.describe('agent readiness', () => {
  test('a missing HTML path is HTTP 404 with a markdown recovery map', async ({ request }) => {
    const response = await request.get('/this-path-does-not-exist-for-agents')
    expect(response.status()).toBe(404)
    expect(header(response, 'content-type')).toContain('text/markdown')
    const body = await response.text()
    expect(body).toContain('/llms.txt')
    expect(body).toContain('/sitemap.xml')
    expect(body).toContain('/docs/developers')
    expect(body).toContain('/openapi.json')
  })

  test('browsers still receive the HTML 404', async ({ request }) => {
    const response = await request.get('/this-path-does-not-exist-for-agents', {
      headers: { accept: 'text/html' },
    })
    expect(response.status()).toBe(404)
    expect(header(response, 'content-type')).toContain('text/html')
  })

  test('an unknown API path returns the JSON error envelope', async ({ request }) => {
    const response = await request.get('/api/v1/no-such-route')
    expect(response.status()).toBe(404)
    expect(header(response, 'content-type')).toContain('json')
    const body = (await response.json()) as {
      error: { code: string; message: string; hint: string }
    }
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.hint).toMatch(/openapi\.json/)
    expect(body.error.hint).toMatch(/llms\.txt|\/docs\/developers/)
  })

  test('OpenAPI documents a typed Error schema', async ({ request }) => {
    const response = await request.get('/openapi.json')
    expect(response.ok()).toBeTruthy()
    const document = (await response.json()) as {
      components: { schemas: { Error: { required: string[] } } }
      paths: Record<string, { get?: { responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }> } }>
    }
    expect(document.components.schemas.Error.required).toEqual(['error'])
    const schema =
      document.paths['/api/v1/artifacts']?.get?.responses['400']?.content?.['application/json']
        ?.schema
    expect(schema?.$ref).toBe('#/components/schemas/Error')
  })

  test('the developer index is named for dsh.fish', async ({ request }) => {
    const response = await request.get('/docs/developers.md')
    expect(response.ok()).toBeTruthy()
    const body = await response.text()
    expect(body).toMatch(/#\s*dsh\.fish developer resources/)
    expect(body).toContain('/openapi.json')
    expect(body).toContain('"code"')
  })
})
