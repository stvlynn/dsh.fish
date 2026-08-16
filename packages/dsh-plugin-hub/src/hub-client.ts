import { readToken, writeToken, type StoredToken } from './token-store.js'

/** Client id this plugin presents to the hub's device-authorization endpoint. */
export const CLIENT_ID = 'dsh-hub-plugin'

export interface ArtifactSummary {
  id: string
  kind: string
  displayName: string
  summary: string
  keywords: string[]
  verified: boolean
  deprecated: boolean
  stats: { stars: number; downloads: number; installs: number }
  sourceUrl: string
}

export interface InstallStep {
  type: 'add-package' | 'write-file' | 'patch-row' | 'require-credential'
  [key: string]: unknown
}

export interface InstallPlan {
  artifactId: string
  kind: string
  profile: string
  steps: InstallStep[]
  manualCommands: string[]
  warningKeys: string[]
}

export interface DeviceCodeGrant {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export class HubError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'HubError'
  }
}

/**
 * HTTP client for one dsh.fish deployment.
 *
 * Reads are anonymous — browsing and resolving a plan never need an account, so
 * a harness that has never signed in is still fully useful. The stored token is
 * attached when present, which is what lets the hub attribute installs and,
 * later, serve a user's private or unlisted artifacts.
 */
export class HubClient {
  constructor(private readonly baseUrl: string) {}

  async search(input: {
    query?: string
    kind?: string
    limit?: number
  }): Promise<{ items: ArtifactSummary[]; total: number }> {
    const params = new URLSearchParams()
    if (input.query) params.set('q', input.query)
    if (input.kind) params.set('kind', input.kind)
    params.set('limit', String(input.limit ?? 10))
    return this.request(`/api/v1/artifacts?${params.toString()}`)
  }

  async detail(artifactId: string): Promise<ArtifactSummary & { readmeMarkdown?: string }> {
    return this.request(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`)
  }

  /**
   * Resolve the install plan.
   *
   * `record` is only ever set on a real install, never on a lookup, so the
   * hub's install counter stays a count of installs.
   */
  async installPlan(input: {
    artifactId: string
    profile: string
    record: boolean
  }): Promise<InstallPlan> {
    const params = new URLSearchParams({
      profile: input.profile,
      record: String(input.record),
    })
    return this.request(
      `/api/v1/artifacts/${encodeURIComponent(input.artifactId)}/install-plan?${params.toString()}`,
    )
  }

  async whoami(): Promise<{ account: { displayName: string; githubLogin: string | null } | null }> {
    return this.request('/api/v1/me')
  }

  /** Step one of the device grant: ask for a code pair. */
  async requestDeviceCode(): Promise<DeviceCodeGrant> {
    const grant = await this.request<DeviceCodeGrant>('/api/auth/device/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: 'openid profile email' }),
    })
    return {
      ...grant,
      verification_uri: absoluteUrl(this.baseUrl, grant.verification_uri),
      ...(grant.verification_uri_complete === undefined
        ? {}
        : {
            verification_uri_complete: absoluteUrl(
              this.baseUrl,
              grant.verification_uri_complete,
            ),
          }),
    }
  }

  /**
   * Step two: poll until the human approves in a browser.
   *
   * The interval is server-supplied and honours `slow_down` by backing off, as
   * RFC 8628 requires — a client that ignores it gets rate limited and the user
   * sees a login that mysteriously fails.
   */
  async pollForToken(
    grant: DeviceCodeGrant,
    signal: AbortSignal,
  ): Promise<StoredToken> {
    let intervalMs = Math.max(1, grant.interval) * 1000
    const deadline = Date.now() + grant.expires_in * 1000

    while (Date.now() < deadline) {
      if (signal.aborted) throw new HubError('Login cancelled.', 'ABORTED')
      await sleep(intervalMs, signal)

      const response = await fetch(`${this.baseUrl}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: grant.device_code,
          client_id: CLIENT_ID,
        }),
        signal,
      })

      const body = (await response.json().catch(() => ({}))) as {
        access_token?: string
        error?: string
        error_description?: string
      }

      if (body.access_token) {
        const token: StoredToken = {
          accessToken: body.access_token,
          baseUrl: this.baseUrl,
          obtainedAt: new Date().toISOString(),
        }
        await writeToken(token)
        return token
      }

      switch (body.error) {
        case 'authorization_pending':
          break
        case 'slow_down':
          intervalMs += 5000
          break
        case 'access_denied':
          throw new HubError('You denied the request in the browser.', 'ACCESS_DENIED')
        case 'expired_token':
          throw new HubError('The code expired. Start the login again.', 'EXPIRED')
        default:
          throw new HubError(body.error_description ?? 'Device authorization failed.', 'FAILED')
      }
    }

    throw new HubError('The code expired. Start the login again.', 'EXPIRED')
  }

  /** Download one file the plan referenced, as text. */
  async fetchText(url: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(url, { signal })
    if (!response.ok) {
      throw new HubError(`Could not download ${url} (${response.status}).`, 'DOWNLOAD_FAILED')
    }
    return response.text()
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await readToken(this.baseUrl)
    const headers = new Headers(init.headers)
    if (token) headers.set('authorization', `Bearer ${token.accessToken}`)

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers })
    const body = (await response.json().catch(() => ({}))) as
      | T
      | { error?: { code: string; message: string } }

    if (!response.ok) {
      const failure = (body as { error?: { code: string; message: string } }).error
      throw new HubError(
        failure?.message ?? `Request failed with ${response.status}.`,
        failure?.code ?? 'HTTP_ERROR',
      )
    }
    return body as T
  }
}

/** Resolve a possibly-relative verification URI against the hub origin. */
export function absoluteUrl(baseUrl: string, uri: string): string {
  try {
    return new URL(uri).toString()
  } catch {
    return new URL(uri, `${baseUrl.replace(/\/+$/, '')}/`).toString()
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new HubError('Login cancelled.', 'ABORTED'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
