import { describe, expect, it, vi } from 'vitest'
import { withNodeAdmission } from './admission'

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
  it('rejects excess work before calling the database handler', async () => {
    const handler = vi.fn()
    const response = await withNodeAdmission(
      new Request('https://dsh.fish/browse?q=test'),
      { eval: vi.fn().mockResolvedValue(0) },
      handler,
    )
    expect(response.status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
  })
  it('releases the exact owner token even when the handler fails', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
    }
    await expect(
      withNodeAdmission(new Request('https://dsh.fish/browse?q=test'), redis, async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')
    expect(redis.eval).toHaveBeenCalledTimes(2)
    expect(redis.eval.mock.calls[0]?.[4]).toBe(redis.eval.mock.calls[1]?.[3])
  })
})
