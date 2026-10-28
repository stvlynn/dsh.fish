import { readToken, writeToken, type StoredToken } from './token-store.js'

/** Client id this plugin presents to the hub's device-authorization endpoint. */
export const CLIENT_ID = 'dsh-hub-plugin'

/** Client id the `@dsh-fish/cli` binary presents for the same device grant. */
export const CLI_CLIENT_ID = 'dsh-fish-cli'

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
  author?: { name: string; url?: string }
  license?: string
}

export interface ArtifactDetail extends ArtifactSummary {
  readmeMarkdown?: string
  readmeLocale?: string
  readmeMachineTranslated?: boolean
  sourceDocBase?: string
  sourceAssetBase?: string
  availableLocales?: readonly string[]
  publishedAt?: string
}

export interface InstallStep {
  type: 'add-package' | 'write-file'
  [key: string]: unknown
}

export interface InstallPlan {
  artifactId: string
  kind: string
  profile: string
  steps: InstallStep[]
  manualCommands: string[]
  warningKeys: string[]
  /** Commit the registry scanned this artifact from, when the source pins one. */
  scannedAtCommit?: string
}

export interface DeviceCodeGrant {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

/**
 * The review shapes are `type` aliases rather than `interface`s on purpose.
 *
 * `ArtifactReviews` is the canonical value a tool returns, and DSH's
 * `{ type: 'json' }` output schema types that value as `JsonValue`
 * (`null | boolean | number | string | JsonValue[] | Record<string, JsonValue>`).
 * TypeScript gives an interface no implicit index signature, so an interface of
 * otherwise perfectly JSON-safe fields is *not* assignable to `JsonValue`; a
 * structurally identical type alias is. Declaring them as aliases keeps the
 * schema honest — every field here must be JSON, and adding a field that is not
 * is still a compile error — instead of forcing a cast at the call site.
 */
export type ReviewAuthor = {
  name: string
  avatarUrl?: string
}

export type ReviewItem = {
  author: ReviewAuthor
  rating: number
  comment?: string
  createdAt: string
  updatedAt: string
}

export type ReviewSummary = {
  /** One-decimal mean; null while nobody has rated. */
  average: number | null
  count: number
  /** Count per star value: index 0 is the 1-star count, index 4 the 5-star count. */
  distribution: [number, number, number, number, number]
}

/**
 * The registry's community sentiment for one artifact. `scale` travels with
 * the payload so a caller (human or agent) never has to guess what a rating
 * means on this site.
 */
export type ArtifactReviews = {
  artifactId: string
  scale: { min: number; max: number }
  summary: ReviewSummary
  items: ReviewItem[]
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
  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string = CLIENT_ID,
  ) {}

  async search(input: {
    query?: string
    kind?: string
    limit?: number
    locale?: string
  }): Promise<{ items: ArtifactSummary[]; total: number }> {
    const params = new URLSearchParams()
    if (input.query) params.set('q', input.query)
    if (input.kind) params.set('kind', input.kind)
    if (input.locale) params.set('locale', input.locale)
    params.set('limit', String(input.limit ?? 10))
    return this.request(`/api/v1/artifacts?${params.toString()}`)
  }

  async detail(artifactId: string, locale?: string): Promise<ArtifactDetail> {
    const params = new URLSearchParams()
    if (locale) params.set('locale', locale)
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return this.request(`/api/v1/artifacts/${encodeURIComponent(artifactId)}${suffix}`)
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

  async whoami(): Promise<{
    account: { id?: string; displayName: string; avatarUrl?: string | null; isAdmin?: boolean } | null
  }> {
    return this.request('/api/v1/me')
  }

  /**
   * Read community ratings: the site's scale, the aggregate and distribution,
   * and the most recent reviews. Anonymous, like the rest of catalog reads.
   */
  async reviews(input: { artifactId: string; limit?: number }): Promise<ArtifactReviews> {
    const params = new URLSearchParams()
    if (input.limit !== undefined) params.set('limit', String(input.limit))
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return this.request(
      `/api/v1/artifacts/${encodeURIComponent(input.artifactId)}/reviews${suffix}`,
    )
  }

  /**
   * Rate an artifact, replacing the caller's earlier rating if there is one.
   *
   * This is the one catalog write a device token may perform: a rating only
   * ever speaks for the account behind the token. The response is the same
   * read model the website renders, so the caller sees its own rating land in
   * the aggregate.
   */
  async rate(input: {
    artifactId: string
    rating: number
    comment?: string
  }): Promise<ArtifactReviews> {
    return this.request(`/api/v1/artifacts/${encodeURIComponent(input.artifactId)}/reviews/mine`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rating: input.rating,
        ...(input.comment === undefined ? {} : { comment: input.comment }),
      }),
    })
  }

  /** Step one of the device grant: ask for a code pair. */
  async requestDeviceCode(): Promise<DeviceCodeGrant> {
    return this.request('/api/auth/device/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, scope: 'openid profile email' }),
    })
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
          client_id: this.clientId,
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
