import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearToken,
  dshHome,
  readPendingGrant,
  readToken,
  writePendingGrant,
  writeToken,
} from './token-store.js'

describe('token store', () => {
  let home: string | undefined

  afterEach(async () => {
    delete process.env['DSH_HOME']
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })

  async function isolateHome(): Promise<string> {
    home = await mkdtemp(join(tmpdir(), 'dsh-hub-'))
    process.env['DSH_HOME'] = home
    return home
  }

  it('resolves DSH_HOME the same way the harness does', async () => {
    const isolated = await isolateHome()
    expect(dshHome()).toBe(isolated)
  })

  it('round-trips a token only for the origin that minted it', async () => {
    await isolateHome()
    await writeToken({
      accessToken: 'tok_1',
      baseUrl: 'https://dsh.fish',
      obtainedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(await readToken('https://dsh.fish')).toMatchObject({ accessToken: 'tok_1' })
    expect(await readToken('https://hub.example')).toBeUndefined()
  })

  it('drops an expired pending device grant', async () => {
    const isolated = await isolateHome()
    await writePendingGrant({
      baseUrl: 'https://dsh.fish',
      deviceCode: 'dev',
      userCode: '12345678',
      verificationUri: 'https://dsh.fish/device',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      interval: 5,
    })
    expect(await readPendingGrant('https://dsh.fish')).toBeUndefined()
    await expect(readFile(join(isolated, '.dsh-fish-device-pending.json'))).rejects.toThrow()
  })

  it('clears the pending grant together with the token', async () => {
    const isolated = await isolateHome()
    await writePendingGrant({
      baseUrl: 'https://dsh.fish',
      deviceCode: 'dev',
      userCode: '12345678',
      verificationUri: 'https://dsh.fish/device',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      interval: 5,
    })
    await clearToken()
    await expect(readFile(join(isolated, '.dsh-fish-device-pending.json'))).rejects.toThrow()
  })
})
