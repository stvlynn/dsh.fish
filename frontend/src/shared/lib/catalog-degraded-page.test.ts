import { describe, expect, it, vi } from 'vitest'
import { emptyPageOnCatalogFailure } from './catalog-degraded-page'

describe('emptyPageOnCatalogFailure', () => {
  it('passes a successful listing through unchanged', async () => {
    const loaded = { items: [{ id: 'dsh-alpha' }], total: 1, limit: 24, offset: 0 }

    await expect(emptyPageOnCatalogFailure(24, 0, async () => loaded)).resolves.toBe(loaded)
  })

  it('renders an empty rail rather than failing the whole page', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await emptyPageOnCatalogFailure<string>(24, 48, async () => {
      throw new Error('D1 DB exceeded its CPU time limit and was reset.')
    })

    expect(result).toEqual({ items: [], total: 0, limit: 24, offset: 48 })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
