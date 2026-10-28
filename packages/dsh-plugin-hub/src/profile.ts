/**
 * Which profile does `current` mean?
 *
 * A plugin process inherits two things it could mistake for that answer, and
 * neither is authoritative on its own:
 *
 * - `$DSH_PROFILE`. The launcher does not export it into the harness process.
 *   It is contributed to *model shell calls* by `@deepseek-ai/dsh-shell-env`,
 *   rebuilt per call from the `profileContext` service. So a value present in
 *   this process came from a parent shell — a stale fact about some other
 *   harness, not the one running here.
 * - `--profile` in `process.argv`. Real, but only for the explicit form. The
 *   `dsh web` shorthand carries no flag at all.
 *
 * The authoritative signal is the host's own `profileContext` service, which
 * `runProfile` provides with the name it actually mounted. It is asked first;
 * the process-environment and argv chains remain for the paths that construct
 * an installer outside a booted host (the CLI, and tests).
 */

export function profileFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) continue
    if (token === '--profile' || token === '-p') {
      const next = argv[index + 1]
      if (next !== undefined && next !== '' && !next.startsWith('-')) return next
      continue
    }
    if (token.startsWith('--profile=')) {
      const value = token.slice('--profile='.length).trim()
      if (value !== '') return value
    }
  }
  return undefined
}

/** Signals available when resolving `current`. */
export interface ProfileSignals {
  /**
   * The host's `profileContext.name` — the profile the launcher actually
   * mounted. Absent outside a booted harness.
   */
  readonly profileContext?: string | undefined
  readonly env?: NodeJS.Dict<string>
  readonly argv?: readonly string[]
}

export function resolveProfile(configured: string, signals: ProfileSignals = {}): string {
  if (configured !== 'current' && configured.trim() !== '') return configured.trim()

  const contextName = signals.profileContext?.trim()
  if (contextName !== undefined && contextName !== '') return contextName

  const fromArgv = profileFromArgv(signals.argv ?? process.argv)
  if (fromArgv !== undefined) return fromArgv

  // Last resort, and deliberately ranked below argv: see the module note.
  const fromEnv = (signals.env ?? process.env)['DSH_PROFILE']?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv

  return 'web'
}

/**
 * The one profile the launcher reserves for the Electron application.
 *
 * `dsh plugin --profile desktop …` is refused there, so an install aimed at it
 * from a terminal cannot succeed and must not be attempted.
 */
export const ELECTRON_MANAGED_PROFILE = 'desktop'

export function isElectronManagedProfile(profile: string): boolean {
  return profile.trim().toLowerCase() === ELECTRON_MANAGED_PROFILE
}
