/**
 * Build only when there is nothing to load.
 *
 * npm skips `prepare` for a registry tarball but runs it for a git install, and
 * pnpm treats a package that must build at install time as arbitrary code
 * execution the user has to allowlist. A published tarball already carries
 * `lib/`, so this exits before touching the compiler and the npm install path
 * needs no build allowance.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

if (existsSync(join(packageRoot, 'lib', 'index.js'))) {
  process.exit(0)
}

const result = spawnSync(process.execPath, [join(packageRoot, 'scripts', 'build.mjs')], {
  cwd: packageRoot,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
