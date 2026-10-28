import { describe, expect, it } from 'vitest'
import { canAddFacetValue, exceededFacet, FACET_VALUE_LIMITS } from './facet-bounds.js'

describe('exceededFacet', () => {
  it('accepts a selection at every bound', () => {
    expect(
      exceededFacet({
        categories: ['git', 'docs', 'ui'],
        kinds: ['bundle', 'skill'],
        topics: ['git', 'review'],
      }),
    ).toBeUndefined()
  })

  it('names the first facet past its bound', () => {
    expect(exceededFacet({ categories: ['git', 'docs', 'ui', 'theme'] })).toBe('categories')
    expect(exceededFacet({ kinds: ['bundle', 'skill', 'profile'] })).toBe('kinds')
    expect(exceededFacet({ topics: ['a', 'b', 'c'] })).toBe('topics')
  })

  it('counts distinct values, so a repeated filter is not punished', () => {
    // `category=git&category=git` narrows by one category; refusing it would
    // break a harmless duplicate rather than the enumeration being guarded.
    expect(exceededFacet({ categories: ['git', 'git', 'git', 'git', 'docs'] })).toBeUndefined()
  })

  it('ignores empty values, which narrow nothing', () => {
    expect(exceededFacet({ categories: ['git', '', ' ', 'docs', 'ui'] })).toBeUndefined()
  })

  it('treats a missing facet as no selection', () => {
    expect(exceededFacet({})).toBeUndefined()
  })

  it('refuses the shapes measured in production scraper traffic', () => {
    // 4–14 categories per request were the observed range.
    const many = ['ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools']
    expect(exceededFacet({ categories: many.slice(0, 4) })).toBe('categories')
    expect(exceededFacet({ categories: many })).toBe('categories')
  })
})

describe('canAddFacetValue', () => {
  it('allows adding until the bound is reached', () => {
    expect(canAddFacetValue('categories', 0)).toBe(true)
    expect(canAddFacetValue('categories', FACET_VALUE_LIMITS.categories - 1)).toBe(true)
    expect(canAddFacetValue('categories', FACET_VALUE_LIMITS.categories)).toBe(false)
  })

  it('agrees with exceededFacet on the boundary', () => {
    for (const facet of ['categories', 'kinds', 'topics'] as const) {
      const limit = FACET_VALUE_LIMITS[facet]
      const atLimit = Array.from({ length: limit }, (_, index) => `v${index}`)
      expect(exceededFacet({ [facet]: atLimit })).toBeUndefined()
      expect(canAddFacetValue(facet, limit)).toBe(false)
      expect(exceededFacet({ [facet]: [...atLimit, 'one-more'] })).toBe(facet)
    }
  })
})
