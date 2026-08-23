import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DomainError } from '../../domain/shared/error.js'
import { toApiError } from './error-mapper.js'

describe('toApiError', () => {
  it('puts a hint on every domain error so agents know what to do next', () => {
    const { status, body } = toApiError(DomainError.notFound('No artifact with that id.'))
    expect(status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toBe('No artifact with that id.')
    expect(body.error.hint).toMatch(/openapi\.json/)
    expect(body.error.hint).toMatch(/llms\.txt|\/docs\/developers/)
  })

  it('maps schema failures to INVALID_ARGUMENT with a hint at OpenAPI', () => {
    let error: unknown
    try {
      z.object({ q: z.string() }).parse({})
    } catch (caught) {
      error = caught
    }
    const { status, body } = toApiError(error)
    expect(status).toBe(400)
    expect(body.error.code).toBe('INVALID_ARGUMENT')
    expect(body.error.hint).toMatch(/openapi\.json/)
    expect(body.error.details).toEqual({
      issues: expect.arrayContaining([expect.stringMatching(/^q:/)]),
    })
  })

  it('does not leak unexpected failure messages, but still includes a hint', () => {
    const { status, body } = toApiError(new Error('D1 binding DATABASE is missing'))
    expect(status).toBe(500)
    expect(body.error).toEqual({
      code: 'INTERNAL',
      message: 'Unexpected server error.',
      hint: expect.stringMatching(/\/api\/health/),
    })
  })
})
