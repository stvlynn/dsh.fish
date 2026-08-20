import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import type { ReadmeI18nAgent } from '../agents/readme-i18n-agent.js'

/**
 * The Worker's binding surface. One declaration shared by the API, the
 * scheduled crawler and the React Router server build.
 */
export interface HubEnv {
  /** D1 database holding both the catalog and Better Auth's own tables. */
  readonly DB: D1Database
  /** KV namespace used as Better Auth secondary storage and for rate limiting. */
  readonly KV: KVNamespace
  /** React Router client assets served by the same Worker. */
  readonly ASSETS: Fetcher
  /** One durable Agent instance per artifact, addressed by catalog slug. */
  readonly README_I18N_AGENT: DurableObjectNamespace<ReadmeI18nAgent>
  /** OpenCode Go bearer token, stored as a Wrangler secret. */
  readonly OPENCODE_GO_API_KEY: string
  /**
   * DeepSeek official API key, stored as a Wrangler secret. Optional: without
   * it README localization runs on the free OpenCode Go chain only.
   */
  readonly DEEPSEEK_API_KEY?: string
  /** Absolute origin the site is served from, e.g. `https://dsh.fish`. */
  readonly PUBLIC_BASE_URL: string
  readonly BETTER_AUTH_SECRET: string
  /**
   * GitHub OAuth app credentials. Sign-in is GitHub only; without these the
   * sign-in page has nowhere to send the reader.
   */
  readonly GITHUB_CLIENT_ID?: string
  readonly GITHUB_CLIENT_SECRET?: string
  /**
   * Token the crawler uses against the GitHub API. Read-only, public data only;
   * without it the crawler still runs but at the far lower anonymous rate limit.
   */
  readonly GITHUB_TOKEN?: string
  /** Comma-separated account emails granted administrator rights. */
  readonly ADMIN_EMAILS?: string
  /**
   * IndexNow key. Public by design: the Worker serves it verbatim at
   * `/indexnow-<key>.txt` so engines can verify ownership before accepting
   * pushed URLs. A plain var in `wrangler.jsonc`, not a secret. When unset,
   * the verification route answers 404.
   */
  readonly INDEXNOW_KEY?: string
  /**
   * GA4 measurement ID. Public by design: the gtag snippet prints it in every
   * HTML document. A plain var in `wrangler.jsonc`, not a secret. When unset,
   * the site ships no analytics.
   */
  readonly GA_MEASUREMENT_ID?: string
}

export interface HubConfig {
  readonly baseUrl: string
  readonly adminEmails: readonly string[]
  readonly githubToken?: string
}

export function readConfig(env: HubEnv): HubConfig {
  const baseUrl = (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '')
  if (baseUrl === '') {
    // Fail loud rather than defaulting: a wrong origin silently breaks OAuth
    // callbacks and cookie scoping, which is far harder to diagnose later.
    throw new Error('PUBLIC_BASE_URL is required.')
  }
  return {
    baseUrl,
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ''),
    ...(env.GITHUB_TOKEN === undefined ? {} : { githubToken: env.GITHUB_TOKEN }),
  }
}
