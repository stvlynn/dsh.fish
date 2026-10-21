import { describe, expect, it } from 'vitest'
import { settleTogether } from './settle-together'

describe('settleTogether', () => {
  it('preserves ordered results', async () => {
    await expect(
      settleTogether([Promise.resolve(1), Promise.resolve('two')] as const),
    ).resolves.toEqual([1, 'two'])
  })
  it('waits for a sibling before propagating failure', async () => {
    let complete!: () => void
    const sibling = new Promise<void>((resolve) => {
      complete = resolve
    })
    const failure = new Error('fixture failure')
    const result = settleTogether([Promise.reject(failure), sibling] as const)
    let rejected = false
    void result.catch(() => {
      rejected = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(rejected).toBe(false)
    complete()
    await expect(result).rejects.toBe(failure)
  })
})
