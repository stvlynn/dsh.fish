/**
 * Resolve the profile `hub_install` writes into.
 *
 * `current` means "the profile this process booted with". The harness does
 * not export that name as a documented environment variable; `DSH_PROFILE`
 * is honoured when a user or wrapper sets it. Without it, `web` is the
 * profile `dsh web` auto-initializes, so it is the safest concrete fallback.
 */
export function resolveProfile(configured: string): string {
  if (configured !== 'current' && configured.trim() !== '') return configured.trim()
  const fromEnv = process.env['DSH_PROFILE']
  return fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv.trim() : 'web'
}
