/**
 * The same-origin API behind the settings section.
 *
 * The browser half of this plugin is a view, not a second installer: every
 * write here calls the `PlanInstaller` the tools and `@dsh-fish/cli` already
 * use, so a plugin installed from settings and one installed by an agent went
 * through the same code. Two consequences shape the routes below.
 *
 * The stored device token never crosses this boundary. It lives in
 * `$DSH_HOME/.dsh-fish-token.json` at mode 0600, `HubClient` attaches it host
 * side, and no response body carries it — a bundle running in a WebView must
 * not be able to read a bearer credential for the reader's hub account.
 *
 * Sign-in is likewise host driven. The route returns the user code and the
 * verification URL and keeps the device code here; a desktop shell that only
 * navigates loopback can then hand that `https` URL to the system browser
 * instead of steering its own WebView off-origin.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Module augmentation only: the harness webserver package adds `webServer` to
// cordis's `Context`, so importing it is what makes `ctx.inject(['webServer'])`
// typecheck. Nothing from it is called directly.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { HubError, type ArtifactSummary, type DeviceCodeGrant, type HubClient } from './hub-client.js'
import { InstallRefused, type PlanInstaller } from './installer.js'
import { clearToken, readToken } from './token-store.js'
import { isNewerVersion, PLUGIN_VERSION } from './version.js'

/** Mounted under the DSH client's own origin, beside `/api/local-models`. */
export const API_ROOT = '/api/dsh-fish'

const MAX_BODY_BYTES = 16 * 1024
const SEARCH_LIMIT = 24

export interface HttpDependencies {
  readonly client: HubClient
  readonly installer: PlanInstaller
  readonly baseUrl: string
  readonly profile: string
}

/**
 * A sign-in waiting on a human.
 *
 * The device code stays here because it is the half that redeems the token;
 * the browser only ever learns the user code it has to type and the URL to
 * open. One at a time: starting a second login abandons the first.
 */
interface PendingLogin {
  readonly userCode: string
  readonly verificationUrl: string
  readonly expiresAt: number
  readonly abort: AbortController
  error?: string
}

export function registerHttpApi(ctx: Context, deps: HttpDependencies): void {
  let pending: PendingLogin | undefined

  const startLogin = async (): Promise<PendingLogin> => {
    pending?.abort.abort()
    const grant: DeviceCodeGrant = await deps.client.requestDeviceCode()
    const abort = new AbortController()
    const login: PendingLogin = {
      userCode: grant.user_code,
      verificationUrl: grant.verification_uri_complete ?? grant.verification_uri,
      expiresAt: Date.now() + grant.expires_in * 1000,
      abort,
    }
    pending = login

    // The poll outlives the request that started it: the reader has to approve
    // in a browser, and an HTTP request held open for that long would time out
    // in front of them. Progress is read back through `GET /state`.
    void deps.client.pollForToken(grant, abort.signal).then(
      () => {
        if (pending === login) pending = undefined
      },
      (error: unknown) => {
        if (pending === login) login.error = message(error)
      },
    )

    return login
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://dsh-fish.invalid')
    const route = url.pathname.slice(API_ROOT.length) || '/'

    if (req.method === 'GET') {
      switch (route) {
        case '/state':
          json(res, 200, {
            version: PLUGIN_VERSION,
            profile: deps.profile,
            baseUrl: deps.baseUrl,
            account: await account(deps, pending),
            installed: (await deps.installer.list()).map((item) => ({
              artifactId: item.artifactId,
              kind: item.kind,
              installedAt: item.installedAt,
              packages: item.packages.map((pkg) => pkg.name),
              files: item.files,
            })),
          })
          return
        case '/check-update': {
          let latestVersion = PLUGIN_VERSION
          try {
            const resNpm = await fetch('https://registry.npmjs.org/@dsh-fish%2Fhub/latest', {
              headers: { accept: 'application/json' },
              signal: AbortSignal.timeout(6000),
            })
            if (resNpm.ok) {
              const data = (await resNpm.json()) as { version?: string }
              if (typeof data.version === 'string') {
                latestVersion = data.version
              }
            }
          } catch {
            // keep fallback
          }
          const hasUpdate = isNewerVersion(PLUGIN_VERSION, latestVersion)
          json(res, 200, {
            currentVersion: PLUGIN_VERSION,
            latestVersion,
            hasUpdate,
          })
          return
        }
        case '/catalog': {
          const query = url.searchParams.get('q')?.trim()
          const kind = url.searchParams.get('kind')?.trim()
          const locale = url.searchParams.get('locale')?.trim()
          const result = await deps.client.search({
            ...(query === undefined || query === '' ? {} : { query }),
            ...(kind === undefined || kind === '' ? {} : { kind }),
            ...(locale === undefined || locale === '' ? {} : { locale }),
            limit: SEARCH_LIMIT,
          })
          json(res, 200, { total: result.total, items: result.items.map(card) })
          return
        }
        case '/detail': {
          const artifactId = requireId(url.searchParams.get('artifactId'))
          const locale = url.searchParams.get('locale')?.trim()
          const detail = await deps.client.detail(
            artifactId,
            locale === undefined || locale === '' ? undefined : locale,
          )
          json(res, 200, detail)
          return
        }
        case '/plan': {
          const artifactId = requireId(url.searchParams.get('artifactId'))
          const plan = await deps.client.installPlan({
            artifactId,
            profile: deps.profile,
            record: false,
          })
          json(res, 200, {
            artifactId,
            profile: plan.profile,
            commands: plan.manualCommands,
            warnings: plan.warningKeys,
            requiresBuildAllowance: plan.steps.some(
              (step) => step.type === 'add-package' && step['requiresBuildAllowance'] === true,
            ),
          })
          return
        }
        default:
          json(res, 404, { error: 'not found' })
          return
      }
    }

    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }

    switch (route) {
      case '/install':
      case '/update': {
        const body = await readJson(req)
        const artifactId = requireId(body['artifactId'])
        const replaceExisting = route === '/update'
        if (replaceExisting) {
          const installed = await deps.installer.list()
          if (!installed.some((item) => item.artifactId === artifactId)) {
            throw new InstallRefused(
              `Nothing installed as ${artifactId} in profile ${deps.profile}.`,
              'NOT_INSTALLED',
            )
          }
        }
        const plan = await deps.client.installPlan({
          artifactId,
          profile: deps.profile,
          record: true,
        })
        const outcome = await deps.installer.apply(plan, {
          // A build step runs the package's own code outside any sandbox, so
          // the reader has to have said yes to this specific install.
          allowBuildScripts: body['allowBuildScripts'] === true,
          signal: AbortSignal.timeout(10 * 60_000),
          ...(replaceExisting ? { replaceExisting } : {}),
        })
        json(res, 200, {
          artifactId: outcome.artifactId,
          steps: outcome.steps.map((step) => ({ summary: step.summary, applied: step.applied })),
          credentialsNeeded: [...outcome.credentialsNeeded],
          restartRequired: outcome.restartRequired,
          warnings: plan.warningKeys,
        })
        return
      }
      case '/remove': {
        const body = await readJson(req)
        const outcome = await deps.installer.remove(requireId(body['artifactId']), {
          signal: AbortSignal.timeout(5 * 60_000),
        })
        json(res, 200, {
          artifactId: outcome.artifactId,
          steps: outcome.steps.map((step) => ({ summary: step.summary, applied: step.applied })),
          restartRequired: outcome.restartRequired,
        })
        return
      }
      case '/self-update': {
        const step = await deps.installer.updateSelf('@dsh-fish/hub')
        json(res, 200, {
          applied: true,
          restartRequired: true,
          step,
        })
        return
      }
      case '/account/login': {
        const login = await startLogin()
        json(res, 200, {
          userCode: login.userCode,
          verificationUrl: login.verificationUrl,
          expiresAt: new Date(login.expiresAt).toISOString(),
        })
        return
      }
      case '/account/logout': {
        pending?.abort.abort()
        pending = undefined
        await clearToken()
        json(res, 200, { signedIn: false })
        return
      }
      default:
        json(res, 404, { error: 'not found' })
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: API_ROOT,
          handler: async (req, res) => {
            try {
              await handle(req, res)
            } catch (error) {
              respondFailure(ctx, res, error)
            }
          },
        }),
      'dsh.fish: settings API',
    )
  })
}

async function account(
  deps: HttpDependencies,
  pending: PendingLogin | undefined,
): Promise<{
  signedIn: boolean
  displayName?: string
  avatarUrl?: string | null
  pendingUserCode?: string
  pendingVerificationUrl?: string
  error?: string
}> {
  const stored = await readToken(deps.baseUrl)
  if (stored !== undefined) {
    const me = await deps.client.whoami()
    if (me.account !== null) {
      return {
        signedIn: true,
        displayName: me.account.displayName,
        avatarUrl: me.account.avatarUrl ?? null,
      }
    }
    // A file on disk is not a session the hub recognises. Do not keep the
    // waiting copy up — that is how Approve-in-browser-then-still-waiting
    // looks when the token poll wrote a credential `/me` will not accept.
    return { signedIn: false, error: 'The stored session was not accepted. Sign in again.' }
  }
  if (pending !== undefined && pending.expiresAt > Date.now() && pending.error === undefined) {
    return {
      signedIn: false,
      pendingUserCode: pending.userCode,
      pendingVerificationUrl: pending.verificationUrl,
    }
  }
  return { signedIn: false, ...(pending?.error === undefined ? {} : { error: pending.error }) }
}

function card(item: ArtifactSummary): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    displayName: item.displayName,
    summary: item.summary,
    verified: item.verified,
    deprecated: item.deprecated,
    installs: item.stats?.installs ?? 0,
    sourceUrl: item.sourceUrl,
    author: item.author,
    license: item.license,
  }
}

class BadRequest extends Error {}

/** Hub ids and package specs: kebab-case slugs, scoped packages like @dsh-fish/hub, or namespaced ids. */
function requireId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('..') ||
    value.includes('\\') ||
    !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9._:-]{0,199}$/i.test(value.trim())
  ) {
    throw new BadRequest('artifactId is invalid')
  }
  return value.trim()
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new BadRequest('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequest('request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

/**
 * Map a failure onto a status the browser half can act on.
 *
 * A refused install is not a server fault: `BUILD_ALLOWANCE_REQUIRED` is the
 * reader's decision to make, so it comes back as a 409 carrying its code
 * rather than as an opaque 500.
 */
function respondFailure(ctx: Context, res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end()
    return
  }
  if (error instanceof BadRequest) {
    json(res, 400, { error: error.message })
    return
  }
  if (error instanceof InstallRefused) {
    json(res, 409, { error: error.message, code: error.code })
    return
  }
  if (error instanceof HubError) {
    json(res, error.code === 'UNAUTHENTICATED' ? 401 : 502, {
      error: error.message,
      code: error.code,
    })
    return
  }
  ctx.logger?.error?.(message(error))
  json(res, 500, { error: message(error) })
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
