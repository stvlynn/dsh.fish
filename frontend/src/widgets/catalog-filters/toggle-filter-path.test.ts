import { describe, expect, it } from 'vitest'
import { canonicalQuery, toggleFilterPath } from './toggle-filter-path'

describe('toggleFilterPath', () => {
  it('writes the same URL for the same selection whatever the click order', () => {
    // The origin cache keys on the URL; two orders used to pay for two queries.
    const ab = toggleFilterPath(new URLSearchParams('category=docs'), 'category', 'git')
    const ba = toggleFilterPath(new URLSearchParams('category=git'), 'category', 'docs')
    expect(ab).toBe(ba)
    expect(ab).toBe('/browse?category=docs&category=git')
  })

  it('removes a selected value and resets pagination', () => {
    expect(toggleFilterPath(new URLSearchParams('category=git&offset=48'), 'category', 'git')).toBe('/browse')
  })

  it('keeps unrelated parameters in a fixed order', () => {
    expect(toggleFilterPath(new URLSearchParams('sort=recent&q=git&kind=skill'), 'category', 'ui')).toBe(
      '/browse?q=git&kind=skill&category=ui&sort=recent',
    )
  })
})

describe('canonicalQuery', () => {
  it('de-duplicates and sorts set-valued filters and drops empty values', () => {
    expect(canonicalQuery(new URLSearchParams('category=ui&category=git&category=ui&kind=&q=x')).toString()).toBe(
      'q=x&category=git&category=ui',
    )
  })

  it('preserves the order of a non-set parameter', () => {
    expect(canonicalQuery(new URLSearchParams('utm=b&utm=a')).toString()).toBe('utm=b&utm=a')
  })
})
