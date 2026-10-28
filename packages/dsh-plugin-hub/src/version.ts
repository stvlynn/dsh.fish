/**
 * The version this plugin reports to its own surfaces.
 *
 * Read from `package.json` rather than written here. It used to be a literal,
 * which meant a release had to remember to edit two files: bump the manifest
 * and bump this constant. Forgetting the second made "Check for updates"
 * compare the new build against its own stale string and report "already up to
 * date" on an upgrade it should have offered — a failure with no symptom until
 * someone noticed the button never fired.
 *
 * `../package.json` is one level above both `src/` and the built `lib/`, so the
 * same expression resolves in a checkout and in a published tarball.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function readManifestVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
    version?: string
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error('@dsh-fish/hub package.json declares no version')
  }
  return manifest.version
}

export const PLUGIN_VERSION = readManifestVersion()

/** Whether `target` is a strictly newer release than `current`. */
export function isNewerVersion(current: string, target: string): boolean {
  const currentParts = current.split('.').map((p) => parseInt(p, 10) || 0)
  const targetParts = target.split('.').map((p) => parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(currentParts.length, targetParts.length); i++) {
    const c = currentParts[i] ?? 0
    const t = targetParts[i] ?? 0
    if (t > c) return true
    if (t < c) return false
  }
  return false
}
