/**
 * Cordis 4 validates plugin `Config` through the Standard Schema interface
 * (`Config['~standard'].validate`). A plain defaults object is truthy, so the
 * loader would call `.validate` on `undefined` and refuse to boot the whole
 * tree — including every other bundle in the profile.
 */

export interface Config {
  /** Registry origin. A self-hosted deployment only needs this changed. */
  baseUrl: string
  /**
   * Profile installs are written into. `current` resolves to the profile this
   * harness booted with, which is almost always what a user means.
   */
  targetProfile: string
}

export const DEFAULT_CONFIG: Config = {
  baseUrl: 'https://dsh.fish',
  targetProfile: 'current',
}

interface StandardIssue {
  readonly message: string
  readonly path?: PropertyKey[]
}

export interface StandardResult {
  readonly value?: Config
  readonly issues?: readonly StandardIssue[]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function optionalString(value: unknown, fallback: string): string | StandardIssue {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    return { message: 'expected a string' }
  }
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
}

export function parseConfig(value: unknown): StandardResult {
  const input = asRecord(value)
  const issues: StandardIssue[] = []
  const baseUrl = optionalString(input['baseUrl'], DEFAULT_CONFIG.baseUrl)
  const targetProfile = optionalString(input['targetProfile'], DEFAULT_CONFIG.targetProfile)
  if (typeof baseUrl !== 'string') issues.push({ ...baseUrl, path: ['baseUrl'] })
  if (typeof targetProfile !== 'string') issues.push({ ...targetProfile, path: ['targetProfile'] })
  if (issues.length > 0) return { issues }
  return {
    value: {
      baseUrl: baseUrl as string,
      targetProfile: targetProfile as string,
    },
  }
}

export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: '@dsh-fish/hub',
    validate(value: unknown): StandardResult {
      return parseConfig(value)
    },
  },
}
