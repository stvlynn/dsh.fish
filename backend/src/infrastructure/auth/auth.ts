import type { MySql2Database } from 'drizzle-orm/mysql2'
import * as mysqlSchema from '../persistence/mysql-schema.js'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { bearer, deviceAuthorization } from 'better-auth/plugins'
import { withCloudflare } from 'better-auth-cloudflare'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { drizzle } from 'drizzle-orm/d1'
import type { D1Database, IncomingRequestCfProperties } from '@cloudflare/workers-types'
import * as schema from '../persistence/schema.js'
import type { HubEnv } from '../config/env.js'
import { d1SafeConsumeOne } from './d1-safe-consume.js'

/** The client id the hub plugin presents when it starts a device flow. */
export const HUB_PLUGIN_CLIENT_ID = 'dsh-hub-plugin'

/** The client id `@dsh-fish/cli` presents for the same device grant. */
export const HUB_CLI_CLIENT_ID = 'dsh-fish-cli'

const DEVICE_CLIENT_IDS = new Set([HUB_PLUGIN_CLIENT_ID, HUB_CLI_CLIENT_ID])

/** Path the device-approval page is served from. */
export const DEVICE_VERIFICATION_PATH = '/device'

/** Digits in a device user code. Shared with the approval page's code input. */
export const DEVICE_USER_CODE_LENGTH = 8

/**
 * Better Auth, composed for Cloudflare.
 *
 * The same factory serves two callers: the Worker at runtime (with real D1 and
 * KV bindings) and the Better Auth CLI at schema-generation time (with none).
 * Keeping it one function is what stops the generated migration from drifting
 * away from the configuration that actually runs.
 */
export function createAuth(
  env?: HubEnv,
  cf?: IncomingRequestCfProperties,
  baseURL?: string,
  mysqlDb?: MySql2Database<typeof mysqlSchema>,
) {
  const db = env && !mysqlDb ? drizzle(env.DB, { schema }) : ({} as ReturnType<typeof drizzle>)

  const cloudflare = withCloudflare(
    {
      autoDetectIpAddress: true,
      geolocationTracking: false,
      cf: cf ?? ({} as IncomingRequestCfProperties),
      d1: env && !mysqlDb ? { db, options: { usePlural: true } } : undefined,
      ...(env?.KV === undefined ? {} : { kv: env.KV }),
    },
    {
      // Sign-in is GitHub only. A password account has no GitHub identity
      // for the ownership check to read, so email/password is closed rather
      // than left as a parallel path.
      emailAndPassword: { enabled: false },
      socialProviders:
        env?.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
          ? {
              github: {
                clientId: env.GITHUB_CLIENT_ID,
                clientSecret: env.GITHUB_CLIENT_SECRET,
                scope: ['user:email'],
                ...(baseURL === undefined
                  ? {}
                  : { redirectURI: `${baseURL}/api/auth/callback/github` }),
              },
            }
          : {},
      // No `user.additionalFields` for the GitHub identity on purpose. A
      // field declared `input: false` is dropped from an OAuth profile before
      // it is written — `parseAdditionalUserInputFromProviderProfile` skips
      // exactly those fields — so it would always be null; declaring it
      // writable instead would let any signed-in account set its own GitHub
      // identity through `update-user`, which is the one thing the ownership
      // check must not accept. The link Better Auth already records in
      // `accounts` is read directly instead — see `LinkedIdentityReader`.
      plugins: [
        // The CLI half of the hub. A harness on a developer machine cannot
        // receive an OAuth redirect, so it asks for a short user code, the
        // human approves it in a browser already signed in, and the plugin
        // polls until it receives a token.
        deviceAuthorization({
          verificationUri: DEVICE_VERIFICATION_PATH,
          expiresIn: '15m',
          interval: '5s',
          validateClient: async (clientId) => DEVICE_CLIENT_IDS.has(clientId),
          // Numeric so the approval page can use a one-time-code input and the
          // terminal can print something unambiguous — no O/0 or I/1 to
          // misread off a screen and retype.
          userCodeLength: DEVICE_USER_CODE_LENGTH,
          generateUserCode: () => {
            const digits = new Uint8Array(DEVICE_USER_CODE_LENGTH)
            crypto.getRandomValues(digits)
            return Array.from(digits, (byte) => String(byte % 10)).join('')
          },
        }),
        // Lets the plugin present its token as `Authorization: Bearer <token>`
        // on subsequent catalog calls instead of carrying a browser cookie.
        bearer(),
      ],
      rateLimit: {
        enabled: true,
        // KV's minimum TTL is 60s, so a shorter window cannot be enforced.
        window: 60,
        max: 120,
      },
    },
  )

  // withCloudflare's published type omits `database` even though the runtime
  // object includes the drizzle adapter when D1 is configured.
  const database = (cloudflare as { database?: unknown }).database

  return betterAuth({
    ...(env === undefined ? {} : { secret: env.BETTER_AUTH_SECRET }),
    ...(baseURL === undefined ? {} : { baseURL, trustedOrigins: [baseURL] }),
    ...cloudflare,
    // Preserve database-backed sessions when the Cloudflare D1 option is absent.
    ...(mysqlDb
      ? {
          session: { ...(cloudflare as { session?: BetterAuthOptions['session'] }).session, storeSessionInDatabase: true },
          verification: { storeInDatabase: true },
        }
      : {}),
    // D1 rejects Better Auth's drizzle `consumeOne` DELETE subquery. Wrap the
    // live adapter; the CLI schema-generation path below has no D1.
    ...(mysqlDb
      ? {
          database: drizzleAdapter(mysqlDb, {
            provider: 'mysql',
            usePlural: true,
            schema: mysqlSchema,
            transaction: true,
          }),
        }
      : database === undefined
        ? {}
        : { database: d1SafeConsumeOne(database) }),
    // The CLI has no bindings; give it a bare adapter purely so it can read the
    // configured schema shape.
    ...(env
      ? {}
      : {
          database: drizzleAdapter({} as D1Database, {
            provider: 'sqlite',
            usePlural: true,
          }),
        }),
  })
}

/** Export consumed by `better-auth` CLI schema generation. */
export const auth = createAuth()

export type HubAuth = ReturnType<typeof createAuth>
