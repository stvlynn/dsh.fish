/**
 * A disposable `$DSH_HOME` for the DSH end-to-end suite.
 *
 * Every test here writes a profile, installs a package into it, and boots it.
 * Doing that against the real `~/.dsh` would corrupt a user's harness — and on
 * this project's own machines `~/.dsh/profiles/web` carries a live install. So
 * the suite gets its own home under the OS temp directory, created fresh and
 * removed on the way out.
 *
 * The removal is guarded deliberately: a temp home is computed, not assumed, and
 * a delete against a computed path must first prove it is the directory this
 * module created.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/** A throwaway harness home. */
export interface DshSandbox {
  /** Absolute path to use as `$DSH_HOME`. */
  readonly home: string
  /** `<home>/profiles/<name>`, the directory a profile lives in. */
  profileDir(name: string): string
  /** Remove the whole home. Safe to call twice. */
  dispose(): void
}

/**
 * Create an isolated harness home.
 *
 * @param label - short tag folded into the directory name for debuggability.
 * @returns the sandbox; call {@link DshSandbox.dispose} when finished.
 */
export function createDshSandbox(label: string): DshSandbox {
  const home = mkdtempSync(join(tmpdir(), `dsh-fish-e2e-${label}-`))
  let disposed = false
  return {
    home,
    profileDir: (name: string) => join(home, 'profiles', name),
    dispose(): void {
      if (disposed) return
      disposed = true
      // The path was produced by mkdtempSync above, so it is known to be a
      // directory this process created under the OS temp root. Re-check the two
      // invariants that matter before deleting, because a future refactor could
      // otherwise turn this into `rm -rf /`.
      const root = resolve(tmpdir())
      const target = resolve(home)
      if (!target.startsWith(`${root}${sep}`)) {
        throw new Error(`refusing to remove ${target}: not under the temp directory ${root}`)
      }
      if (!target.includes('-e2e-')) {
        throw new Error(`refusing to remove ${target}: not a dsh-fish e2e sandbox`)
      }
      rmSync(target, { recursive: true, force: true })
    },
  }
}
