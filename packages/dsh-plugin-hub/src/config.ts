/**
 * Plugin configuration, as Cordis requires it: a Standard Schema, not a
 * plain defaults object. A plain object does not implement `~standard`, so
 * the loader cannot validate the row and the plugin fails to start.
 *
 * Schemastery is the usual authoring API in first-party plugins, but it is
 * not installable standalone during the harness developer preview (the same
 * constraint as `@deepseek-ai/dsh-tools`). Cordis accepts any Standard Schema
 * validator, so this file implements that interface for the two fields the
 * plugin actually reads.
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
}

type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] }

export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'dsh-hub',
    validate(value: unknown): StandardResult<Config> {
      if (value === undefined || value === null) {
        return { value: { ...DEFAULT_CONFIG } }
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'config must be an object' }] }
      }
      const input = value as Record<string, unknown>
      const baseUrl = readString(input['baseUrl'], 'baseUrl')
      if (typeof baseUrl !== 'string') return { issues: [{ message: baseUrl.message }] }
      const targetProfile = readString(input['targetProfile'], 'targetProfile')
      if (typeof targetProfile !== 'string') {
        return { issues: [{ message: targetProfile.message }] }
      }
      return {
        value: {
          baseUrl: baseUrl === '' ? DEFAULT_CONFIG.baseUrl : baseUrl.replace(/\/+$/, ''),
          targetProfile: targetProfile === '' ? DEFAULT_CONFIG.targetProfile : targetProfile,
        },
      }
    },
  },
}

function readString(
  value: unknown,
  field: string,
): string | { message: string } {
  if (value === undefined) return ''
  if (typeof value !== 'string') return { message: `${field} must be a string` }
  return value.trim()
}
