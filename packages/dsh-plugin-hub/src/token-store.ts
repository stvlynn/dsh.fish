import { chmod, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StoredToken {
  readonly accessToken: string
  readonly baseUrl: string
  readonly obtainedAt: string
  readonly accountLabel?: string
}

/**
 * Resolve the harness home the same way the harness itself does: an explicit
 * `$DSH_HOME`, then `~/.dsh`. Storing beside the harness's own state keeps the
 * token with everything else a user would delete to reset a machine.
 */
export function dshHome(): string {
  const configured = process.env['DSH_HOME']
  if (configured !== undefined && configured.trim() !== '') return configured
  return join(homedir(), '.dsh')
}

export interface StoredPendingGrant {
  readonly baseUrl: string
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresAt: string
  readonly interval: number
}

function tokenPath(): string {
  return join(dshHome(), '.dsh-fish-token.json')
}

function pendingPath(): string {
  return join(dshHome(), '.dsh-fish-device-pending.json')
}

async function writeSecret(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
}

/**
 * Persisted device-grant token.
 *
 * Written 0600 and never logged. It is a bearer credential for one account, so
 * it is treated the way the harness treats every other secret: it lives outside
 * any configuration file that might be synced or rendered in a UI.
 */
export async function readToken(baseUrl: string): Promise<StoredToken | undefined> {
  try {
    const raw = await readFile(tokenPath(), 'utf8')
    const parsed = JSON.parse(raw) as StoredToken
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken === '') return undefined
    // A token minted against another deployment must not be presented here.
    if (parsed.baseUrl !== baseUrl) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export async function writeToken(token: StoredToken): Promise<void> {
  await writeSecret(tokenPath(), token)
}

export async function clearToken(): Promise<void> {
  await rm(tokenPath(), { force: true })
  await rm(pendingPath(), { force: true })
}

export async function readPendingGrant(baseUrl: string): Promise<StoredPendingGrant | undefined> {
  try {
    const raw = await readFile(pendingPath(), 'utf8')
    const parsed = JSON.parse(raw) as StoredPendingGrant
    if (parsed.baseUrl !== baseUrl) return undefined
    if (typeof parsed.deviceCode !== 'string' || parsed.deviceCode === '') return undefined
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      await clearPendingGrant()
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export async function writePendingGrant(grant: StoredPendingGrant): Promise<void> {
  await writeSecret(pendingPath(), grant)
}

export async function clearPendingGrant(): Promise<void> {
  await rm(pendingPath(), { force: true })
}
