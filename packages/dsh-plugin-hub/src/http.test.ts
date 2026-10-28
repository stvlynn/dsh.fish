import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HubError, type HubClient } from './hub-client.js'
import { API_ROOT, registerHttpApi } from './http.js'
import { PlanInstaller } from './installer.js'

/**
 * A composition stub with a `webServer`, driving the real route through a real
 * `node:http` server so the handler is exercised the way the harness does.
 */
function context(): { ctx: Context; route: () => WebRoute } {
  let registered: WebRoute | undefined
  const ctx = {
    inject: (_services: readonly string[], callback: (ctx: Context) => void) => { callback(ctx) },
    effect: (setup: () => () => void) => setup(),
    webServer: {
      register: (route: WebRoute) => {
        registered = route
        return () => { registered = undefined }
      },
    },
  } as unknown as Context
  return {
    ctx,
    route: () => {
      if (registered === undefined) throw new Error('no route registered')
      return registered
    },
  }
}

/** A composition with no browser client: `ctx.inject` never fires. */
function headlessContext(): Context {
  return {
    inject: () => undefined,
    effect: (setup: () => () => void) => setup(),
  } as unknown as Context
}

describe('settings API', () => {
  let server: Server | undefined
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-http-'))
  })

  afterEach(async () => {
    const running = server
    server = undefined
    if (running !== undefined) await new Promise<void>((done) => { running.close(() => { done() }) })
  })

  async function listen(deps: {
    client: Partial<HubClient>
    profile?: string
  }): Promise<(path: string, init?: RequestInit) => Promise<{ status: number; body: string }>> {
    const profile = deps.profile ?? 'local-dsh'
    const { ctx, route } = context()
    registerHttpApi(ctx, {
      client: deps.client as HubClient,
      installer: new PlanInstaller(deps.client as HubClient, profile, {
        home,
        run: async () => ({ stdout: '', stderr: '' }),
      }),
      baseUrl: 'https://dsh.fish',
      profile,
    })
    const handler = route().handler
    const running = createServer((req, res) => { void handler(req, res) })
    server = running
    await new Promise<void>((done) => { running.listen(0, '127.0.0.1', () => { done() }) })
    const { port } = running.address() as AddressInfo
    return async (path, init) => {
      const response = await fetch(`http://127.0.0.1:${port}${API_ROOT}${path}`, init)
      return { status: response.status, body: await response.text() }
    }
  }

  it('loads in a profile with no browser client, without registering a route', () => {
    expect(() =>
      registerHttpApi(headlessContext(), {
        client: {} as HubClient,
        installer: new PlanInstaller({} as HubClient, 'web', { home }),
        baseUrl: 'https://dsh.fish',
        profile: 'web',
      }),
    ).not.toThrow()
  })

  it('does not keep a stored token that /me rejects behind the waiting copy', async () => {
    await writeFile(
      join(home, '.dsh-fish-token.json'),
      JSON.stringify({
        baseUrl: 'https://dsh.fish',
        accessToken: 'stale-token',
        obtainedAt: new Date().toISOString(),
      }),
    )
    process.env['DSH_HOME'] = home
    const request = await listen({
      client: { whoami: async () => ({ account: null }) },
    })

    const state = await request('/state')
    expect(JSON.parse(state.body)).toMatchObject({
      account: { signedIn: false, error: 'The stored session was not accepted. Sign in again.' },
    })
  })

  it('reports the booted profile and never echoes the stored token', async () => {
    await writeFile(
      join(home, '.dsh-fish-token.json'),
      JSON.stringify({ baseUrl: 'https://dsh.fish', accessToken: 'super-secret-token' }),
    )
    process.env['DSH_HOME'] = home
    const request = await listen({
      client: {
        whoami: async () => ({
          account: {
            id: 'acc-1',
            displayName: 'Ada',
            avatarUrl: 'https://example.com/ada.png',
            isAdmin: false,
          },
        }),
      },
    })

    const state = await request('/state')
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toMatchObject({
      profile: 'local-dsh',
      account: { signedIn: true, displayName: 'Ada', avatarUrl: 'https://example.com/ada.png' },
      installed: [],
    })
    expect(state.body).not.toContain('super-secret-token')
  })

  it('serves artifact detail with locale and readme', async () => {
    process.env['DSH_HOME'] = home
    let requestedLocale: string | undefined
    const request = await listen({
      client: {
        detail: async (_artifactId: string, locale?: string) => {
          requestedLocale = locale
          return {
            id: 'release-notes',
            kind: 'bundle',
            displayName: 'Release notes',
            summary: 'Release notes summary',
            keywords: [],
            verified: true,
            deprecated: false,
            stats: { stars: 5, downloads: 10, installs: 2 },
            sourceUrl: 'https://github.com/acme/release-notes',
            readmeMarkdown: '# Hello from README',
            readmeLocale: locale,
          }
        },
      },
    })

    const detail = await request('/detail?artifactId=release-notes&locale=zh-CN')
    expect(detail.status).toBe(200)
    expect(requestedLocale).toBe('zh-CN')
    expect(JSON.parse(detail.body)).toMatchObject({
      id: 'release-notes',
      displayName: 'Release notes',
      readmeMarkdown: '# Hello from README',
    })
  })

  it('surfaces a poll failure on GET /state instead of leaving the login waiting', async () => {
    process.env['DSH_HOME'] = home
    let fail: ((error: Error) => void) | undefined
    const request = await listen({
      client: {
        requestDeviceCode: async () => ({
          device_code: 'device-secret',
          user_code: '43085132',
          verification_uri: 'https://dsh.fish/device',
          verification_uri_complete: 'https://dsh.fish/device?user_code=43085132',
          expires_in: 600,
          interval: 5,
        }),
        pollForToken: () =>
          new Promise<never>((_resolve, reject) => {
            fail = reject
          }),
      },
    })

    await request('/account/login', { method: 'POST' })
    fail?.(new HubError('Device authorization failed.', 'FAILED'))
    await new Promise<void>((done) => { setTimeout(done, 0) })

    const state = await request('/state')
    expect(JSON.parse(state.body)).toMatchObject({
      account: { signedIn: false, error: 'Device authorization failed.' },
    })
    expect(state.body).not.toContain('43085132')
  })

  it('returns the user code and an https verification URL, keeping the device code', async () => {
    process.env['DSH_HOME'] = home
    const request = await listen({
      client: {
        requestDeviceCode: async () => ({
          device_code: 'device-secret',
          user_code: 'WXYZ-1234',
          verification_uri: 'https://dsh.fish/device',
          verification_uri_complete: 'https://dsh.fish/device?user_code=WXYZ-1234',
          expires_in: 600,
          interval: 5,
        }),
        pollForToken: async () => new Promise(() => undefined),
      },
    })

    const started = await request('/account/login', { method: 'POST' })
    expect(started.status).toBe(200)
    const body = JSON.parse(started.body) as { userCode: string; verificationUrl: string }
    expect(body.userCode).toBe('WXYZ-1234')
    expect(body.verificationUrl.startsWith('https://')).toBe(true)
    expect(started.body).not.toContain('device-secret')
  })

  it('refuses an install that would build from source until the reader allows it', async () => {
    process.env['DSH_HOME'] = home
    const request = await listen({
      client: {
        installPlan: async () => ({
          artifactId: 'needs-build',
          kind: 'bundle',
          profile: 'local-dsh',
          manualCommands: [],
          warningKeys: ['buildAllowance'],
          steps: [
            {
              type: 'add-package',
              profile: 'local-dsh',
              spec: 'github:acme/thing',
              requiresBuildAllowance: true,
            },
          ],
        }),
      },
    })

    const refused = await request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactId: 'needs-build' }),
    })
    expect(refused.status).toBe(409)
    expect(JSON.parse(refused.body)).toMatchObject({ code: 'BUILD_ALLOWANCE_REQUIRED' })

    const allowed = await request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactId: 'needs-build', allowBuildScripts: true }),
    })
    expect(allowed.status).toBe(200)
    expect(JSON.parse(allowed.body)).toMatchObject({ restartRequired: true })
  })

  it('installs through the shared lockfile, so Installed matches what the tools see', async () => {
    process.env['DSH_HOME'] = home
    const request = await listen({
      client: {
        installPlan: async () => ({
          artifactId: 'release-notes',
          kind: 'bundle',
          profile: 'local-dsh',
          manualCommands: [],
          warningKeys: [],
          steps: [
            {
              type: 'add-package',
              profile: 'local-dsh',
              spec: 'dsh-hello@1.2.3',
              requiresBuildAllowance: false,
            },
          ],
        }),
      },
    })

    await request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artifactId: 'release-notes' }),
    })

    const lock = JSON.parse(await readFile(join(home, '.dsh-fish-lock.json'), 'utf8')) as {
      artifacts: Record<string, { artifactId: string; profile: string }>
    }
    expect(lock.artifacts['local-dsh:release-notes']).toMatchObject({
      artifactId: 'release-notes',
      profile: 'local-dsh',
    })

    const state = await request('/state')
    expect(JSON.parse(state.body)).toMatchObject({
      installed: [{ artifactId: 'release-notes' }],
    })
  })

  it('checks for plugin update and updates self', async () => {
    process.env['DSH_HOME'] = home
    const request = await listen({
      client: {},
    })

    const check = await request('/check-update')
    expect(check.status).toBe(200)
    const checkData = JSON.parse(check.body)
    expect(checkData).toHaveProperty('currentVersion')
    expect(checkData).toHaveProperty('hasUpdate')

    const selfUpdate = await request('/self-update', { method: 'POST' })
    expect(selfUpdate.status).toBe(200)
    expect(JSON.parse(selfUpdate.body)).toMatchObject({
      applied: true,
      restartRequired: true,
    })
  })

  it('rejects an unknown route and an artifact id that is not one', async () => {
    process.env['DSH_HOME'] = home
    const request = await listen({ client: {} })
    expect((await request('/nope')).status).toBe(404)
    expect((await request('/plan?artifactId=../../etc/passwd')).status).toBe(400)
  })
})
