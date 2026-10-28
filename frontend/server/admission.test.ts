import { describe, expect, it, vi } from 'vitest'
import { withNodeAdmission } from './admission'

const NAVIGATE = { 'sec-fetch-mode': 'navigate' }
const FETCH = { 'sec-fetch-mode': 'cors' }

function costly(headers: Record<string, string> = NAVIGATE): Request {
  return new Request('https://dsh.fish/browse?q=test', { headers })
}

describe('Node catalog admission lifecycle', () => {
  it('keeps basic routes available without acquiring the search lease', async () => {
    const redis = { eval: vi.fn() }
    const response = await withNodeAdmission(
      new Request('https://dsh.fish/'),
      redis,
      async () => new Response('home'),
    )
    expect(await response.text()).toBe('home')
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it('lets an over-bound union reach its handler without spending capacity', async () => {
    const redis = { eval: vi.fn() }
    const handler = vi.fn(async () => new Response(null, { status: 404 }))
    const response = await withNodeAdmission(
      new Request('https://dsh.fish/browse?category=ui&category=usage&category=theme&category=model'),
      redis,
      handler,
    )
    expect(response.status).toBe(404)
    expect(handler).toHaveBeenCalledOnce()
    expect(redis.eval).not.toHaveBeenCalled()
  })

  it('rejects excess work before calling the database handler', async () => {
    const handler = vi.fn()
    const response = await withNodeAdmission(costly(), { eval: vi.fn().mockResolvedValue(0) }, handler)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('1')
    expect(response.headers.get('x-catalog-admission')).toBe('document;no-tokens')
    expect(handler).not.toHaveBeenCalled()
  })

  it('releases the exact owner token even when the handler fails', async () => {
    const redis = { eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1) }
    await expect(
      withNodeAdmission(costly(), redis, async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')
    expect(redis.eval).toHaveBeenCalledTimes(2)
    // acquire(script, 3, own, borrow, slot, token, …) / release(script, 1, slot, token)
    expect(redis.eval.mock.calls[0]?.[5]).toBe(redis.eval.mock.calls[1]?.[3])
  })

  it('waits for a busy lease without running a second query concurrently', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValueOnce(-1).mockResolvedValueOnce(1).mockResolvedValueOnce(1),
    }
    const handler = vi.fn(async () => new Response('results'))
    const response = await withNodeAdmission(costly(), redis, handler)
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(redis.eval).toHaveBeenCalledTimes(3)
    expect(redis.eval.mock.calls[0]?.[5]).toBe(redis.eval.mock.calls[1]?.[5])
  })

  it('bounds waiting when another query keeps the lease', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(-1) }
    const handler = vi.fn()
    const response = await withNodeAdmission(costly(), redis, handler)
    expect(response.status).toBe(429)
    expect(response.headers.get('x-catalog-admission')).toBe('document;slot-busy')
    expect(handler).not.toHaveBeenCalled()
    expect(redis.eval).toHaveBeenCalledTimes(5)
  })

  it('draws a page load from the document bucket only', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) }
    await withNodeAdmission(costly(NAVIGATE), redis, vi.fn())
    const [, keys, own, borrow, slot] = redis.eval.mock.calls[0] ?? []
    expect(keys).toBe(3)
    expect(own).toBe('hub:catalog:tokens:v2:document')
    expect(borrow).toBe('')
    expect(slot).toBe('hub:catalog:lease')
  })

  it('lets an interactive request borrow from the document bucket', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) }
    await withNodeAdmission(costly(FETCH), redis, vi.fn())
    const [, , own, borrow] = redis.eval.mock.calls[0] ?? []
    expect(own).toBe('hub:catalog:tokens:v2:interactive')
    expect(borrow).toBe('hub:catalog:tokens:v2:document')
  })
})
