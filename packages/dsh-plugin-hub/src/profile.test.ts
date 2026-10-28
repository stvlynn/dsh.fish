import { describe, expect, it } from 'vitest'
import {
  ELECTRON_MANAGED_PROFILE,
  isElectronManagedProfile,
  profileFromArgv,
  resolveProfile,
} from './profile.js'

const ARGV_WITH_PROFILE = ['node', 'dsh', '--profile', 'local-dsh', '--host', '127.0.0.1']
const ARGV_WEB_SHORTHAND = ['node', 'dsh', 'web', '--no-open']

describe('resolveProfile', () => {
  it('keeps an explicit profile name over every host signal', () => {
    expect(
      resolveProfile('staging', {
        profileContext: 'desktop',
        env: { DSH_PROFILE: 'local-dsh' },
        argv: ARGV_WITH_PROFILE,
      }),
    ).toBe('staging')
  })

  it('takes the profile the host actually mounted', () => {
    expect(resolveProfile('current', { profileContext: 'web' })).toBe('web')
  })

  it('prefers the mounted profile over an inherited $DSH_PROFILE', () => {
    // The launcher does not export DSH_PROFILE into the harness process; a value
    // in the environment is the parent shell's stale fact. Trusting it made a
    // booted `web` profile report — and install into — `desktop`.
    expect(
      resolveProfile('current', {
        profileContext: 'web',
        env: { DSH_PROFILE: 'desktop' },
        argv: ARGV_WITH_PROFILE,
      }),
    ).toBe('web')
  })

  it('resolves the `dsh web` shorthand, where argv carries no --profile', () => {
    // This is the case that makes the host signal necessary rather than merely
    // convenient: without it, the inherited value would win outright.
    expect(
      resolveProfile('current', {
        profileContext: 'web',
        env: { DSH_PROFILE: 'desktop' },
        argv: ARGV_WEB_SHORTHAND,
      }),
    ).toBe('web')
  })

  it('still resolves desktop when the host really mounted it', () => {
    expect(
      resolveProfile('current', {
        profileContext: ELECTRON_MANAGED_PROFILE,
        env: { DSH_PROFILE: 'desktop' },
      }),
    ).toBe(ELECTRON_MANAGED_PROFILE)
  })

  it('reads --profile from argv when no host service is present', () => {
    expect(resolveProfile('current', { env: {}, argv: ARGV_WITH_PROFILE })).toBe('local-dsh')
    expect(profileFromArgv(['dsh', '--profile=web', '--no-open'])).toBe('web')
  })

  it('ranks the environment after argv, for a host-less process', () => {
    expect(resolveProfile('current', { env: { DSH_PROFILE: 'local-dsh' }, argv: [] })).toBe(
      'local-dsh',
    )
    expect(
      resolveProfile('current', { env: { DSH_PROFILE: 'stale' }, argv: ARGV_WITH_PROFILE }),
    ).toBe('local-dsh')
  })

  it('falls back to web for a stock launcher with no profile signal', () => {
    expect(resolveProfile('current', { env: {}, argv: ['node', 'dsh', 'web'] })).toBe('web')
  })
})

describe('isElectronManagedProfile', () => {
  it('reserves the desktop profile for the Electron application', () => {
    expect(isElectronManagedProfile('desktop')).toBe(true)
    expect(isElectronManagedProfile('Desktop')).toBe(true)
    expect(isElectronManagedProfile(' desktop ')).toBe(true)
  })

  it('leaves every other profile addressable', () => {
    expect(isElectronManagedProfile('web')).toBe(false)
    expect(isElectronManagedProfile('local-dsh')).toBe(false)
    expect(isElectronManagedProfile('desktop-2')).toBe(false)
  })
})
