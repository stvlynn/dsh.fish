import { afterEach, describe, expect, it } from 'vitest'
import { resolveProfile } from './profile.js'

describe('resolveProfile', () => {
  afterEach(() => {
    delete process.env['DSH_PROFILE']
  })

  it('uses an explicit profile name as-is', () => {
    expect(resolveProfile('headless')).toBe('headless')
  })

  it('reads DSH_PROFILE when the row asks for the current profile', () => {
    process.env['DSH_PROFILE'] = 'demo'
    expect(resolveProfile('current')).toBe('demo')
  })

  it('falls back to web, the profile dsh web auto-initializes', () => {
    expect(resolveProfile('current')).toBe('web')
    expect(resolveProfile('')).toBe('web')
  })
})
