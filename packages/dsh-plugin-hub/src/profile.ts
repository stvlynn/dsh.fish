/**
 * `current` means "the profile this process booted with".
 *
 * The launcher may export it as `DSH_PROFILE`. Desktop shells such as Local DSH
 * also pass `--profile <name>` on the same argv the plugin process inherits.
 * Without either, `web` is what `dsh web` auto-initializes, so it is the
 * safest concrete fallback.
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

export function resolveProfile(
  configured: string,
  env: NodeJS.Dict<string> = process.env,
  argv: readonly string[] = process.argv,
): string {
  if (configured !== 'current' && configured.trim() !== '') return configured.trim()
  const fromEnv = env['DSH_PROFILE']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  const fromArgv = profileFromArgv(argv)
  if (fromArgv !== undefined) return fromArgv
  return 'web'
}
