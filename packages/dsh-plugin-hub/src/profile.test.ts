import { describe, expect, it } from 'vitest'
import { profileFromArgv, resolveProfile } from './profile.js'

describe('resolveProfile', () => {
  const argv = ['node', 'dsh', '--profile', 'local-dsh', '--host', '127.0.0.1']

  it('keeps an explicit profile name', () => {
    expect(resolveProfile('staging', {}, argv)).toBe('staging')
  })

  it('prefers $DSH_PROFILE when the patch says current', () => {
    expect(resolveProfile('current', { DSH_PROFILE: 'local-dsh' }, ['node', 'dsh'])).toBe(
      'local-dsh',
    )
  })

  it('reads --profile from argv when the environment is unset', () => {
    expect(resolveProfile('current', {}, argv)).toBe('local-dsh')
    expect(profileFromArgv(['dsh', '--profile=web', '--no-open'])).toBe('web')
  })

  it('falls back to web for a stock launcher with no profile signal', () => {
    expect(resolveProfile('current', {}, ['node', 'dsh', 'web'])).toBe('web')
  })
})
