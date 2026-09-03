import { describe, expect, it } from 'vitest'
import { usesFtsIndex } from './d1-artifact-repository.js'

describe('usesFtsIndex', () => {
  it('uses FTS only when the flag is on and the query is long enough', () => {
    expect(usesFtsIndex(true, 'postgres')).toBe(true)
    expect(usesFtsIndex(true, 'pg')).toBe(false)
    expect(usesFtsIndex(false, 'postgres')).toBe(false)
  })
})
