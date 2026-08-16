/**
 * dsh.fish inside the harness.
 *
 * Registers four tools on `ctx.tools`, so an agent can find an artifact and put
 * it on the machine without the user leaving their session. The hub resolves
 * *what* to do — the same install plan the website renders — and this plugin
 * decides whether to do it, because it is the side that bears the consequences.
 *
 * @module dsh-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config as HubConfig } from './config.js'
import { HubClient, HubError } from './hub-client.js'
import { InstallRefused, PlanInstaller } from './installer.js'
import { resolveProfile } from './profile.js'
import {
  clearPendingGrant,
  clearToken,
  readPendingGrant,
  readToken,
  writePendingGrant,
} from './token-store.js'

export const name = 'dsh-hub'
export const inject = ['tools']
export { Config } from './config.js'

const KINDS = [
  'bundle',
  'profile',
  'skill',
  'mcp-server',
  'agent-preset',
  'hook-bridge',
] as const

export function apply(ctx: Context, config: HubConfig): void {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const client = new HubClient(baseUrl)
  const profile = resolveProfile(config.targetProfile)
  const installer = new PlanInstaller(client, profile)

  ctx.tools.register(
    defineTool({
      name: 'hub_search',
      description:
        'Search dsh.fish for harness artifacts — bundles, profiles, skills, MCP servers, agent ' +
        'presets and hook bridges. Use it before claiming a capability does not exist, and before ' +
        'writing a plugin from scratch. Returns ids you can pass to hub_install.',
      parameters: {
        query: {
          type: 'string',
          description: 'Free text, e.g. "postgres", "code review", "browser automation".',
        },
        kind: {
          type: 'string',
          enum: [...KINDS],
          description: 'Restrict to one artifact type.',
        },
        limit: { type: 'integer', description: 'Maximum results (default 10).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
      },
      async execute(args) {
        const result = await client.search({
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.kind === undefined ? {} : { kind: args.kind }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        })
        return {
          total: result.total,
          items: result.items.map((item) => ({
            id: item.id,
            kind: item.kind,
            name: item.displayName,
            summary: item.summary,
            verified: item.verified,
            deprecated: item.deprecated,
            installs: item.stats.installs,
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_show',
      description:
        'Show one dsh.fish artifact in detail, including exactly what installing it would do on ' +
        'this machine. Call this before hub_install when the user should see the plan first.',
      parameters: {
        artifactId: { type: 'string', required: true, description: 'Id from hub_search.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderShow(value) }],
      },
      async execute(args) {
        const [detail, plan] = await Promise.all([
          client.detail(args.artifactId),
          client.installPlan({ artifactId: args.artifactId, profile, record: false }),
        ])
        return {
          id: detail.id,
          kind: detail.kind,
          name: detail.displayName,
          summary: detail.summary,
          verified: detail.verified,
          source: detail.sourceUrl,
          profile: plan.profile,
          commands: plan.manualCommands,
          warnings: plan.warningKeys,
          requiresBuildAllowance: plan.steps.some(
            (step) => step['requiresBuildAllowance'] === true,
          ),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_install',
      description:
        'Install a dsh.fish artifact into this harness. Writes skills and presets directly, adds ' +
        'MCP and hook rows to the profile patch layer, and runs the package manager for bundles. ' +
        'The harness must be restarted afterwards for new rows to load. If the artifact builds ' +
        'from source, this refuses until the user has seen the source and agreed.',
      parameters: {
        artifactId: { type: 'string', required: true, description: 'Id from hub_search.' },
        allowBuildScripts: {
          type: 'boolean',
          description:
            'Set only after the user has explicitly agreed to let this package run its build ' +
            'script at install time. Do not set it on your own initiative.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderInstall(value) }],
      },
      timeoutMs: 5 * 60 * 1000,
      async execute(args, exec) {
        const plan = await client.installPlan({
          artifactId: args.artifactId,
          profile,
          record: true,
        })
        const outcome = await installer.apply(plan, {
          allowBuildScripts: args.allowBuildScripts === true,
          signal: exec.signal,
        })
        return {
          artifactId: outcome.artifactId,
          steps: outcome.steps.map((step) => ({
            summary: step.summary,
            applied: step.applied,
            ...(step.detail === undefined ? {} : { detail: step.detail }),
          })),
          credentialsNeeded: [...outcome.credentialsNeeded],
          restartRequired: outcome.restartRequired,
          warnings: plan.warningKeys,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_account',
      description:
        'Sign in to dsh.fish from this machine, or report who is signed in. Signing in uses the ' +
        'OAuth device flow. The first login call returns a short code and a URL — show both to ' +
        'the user and tell them to approve in a browser. Call login again to wait for that ' +
        'approval. You cannot approve it yourself.',
      parameters: {
        action: {
          type: 'string',
          enum: ['status', 'login', 'logout'],
          description: 'Defaults to status.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderAccount(value) }],
      },
      timeoutMs: 16 * 60 * 1000,
      async execute(args, exec) {
        const action = args.action ?? 'status'

        if (action === 'logout') {
          await clearToken()
          return { action, signedIn: false }
        }

        if (action === 'status') {
          const stored = await readToken(baseUrl)
          if (!stored) return { action, signedIn: false }
          const me = await client.whoami()
          return {
            action,
            signedIn: me.account !== null,
            ...(me.account === null ? {} : { account: me.account.displayName }),
          }
        }

        // Login is two calls because a tool result only reaches the model when
        // execute returns. The first call mints a code and returns it so the
        // agent can show the user the URL; the second call polls until they
        // approve in a browser they already trust.
        const pending = await readPendingGrant(baseUrl)
        if (pending === undefined) {
          const grant = await client.requestDeviceCode()
          const verificationUri = grant.verification_uri_complete ?? grant.verification_uri
          await writePendingGrant({
            baseUrl,
            deviceCode: grant.device_code,
            userCode: grant.user_code,
            verificationUri,
            expiresAt: new Date(Date.now() + grant.expires_in * 1000).toISOString(),
            interval: grant.interval,
          })
          ctx.logger?.info?.(`dsh.fish: open ${verificationUri} and enter ${grant.user_code}`)
          return {
            action,
            signedIn: false,
            status: 'authorization_pending',
            userCode: grant.user_code,
            verificationUri,
          }
        }

        const token = await client.pollForToken(
          {
            device_code: pending.deviceCode,
            user_code: pending.userCode,
            verification_uri: pending.verificationUri,
            expires_in: Math.max(1, Math.floor((Date.parse(pending.expiresAt) - Date.now()) / 1000)),
            interval: pending.interval,
          },
          exec.signal,
        )
        await clearPendingGrant()
        const me = await client.whoami()
        return {
          action,
          signedIn: true,
          status: 'authorized',
          ...(me.account === null ? {} : { account: me.account.displayName }),
          obtainedAt: token.obtainedAt,
        }
      },
    }),
  )
}

function renderSearch(value: unknown): string {
  const result = value as { total: number; items: { id: string; kind: string; name: string; summary: string; verified: boolean }[] }
  if (result.items.length === 0) return 'No matching artifacts on dsh.fish.'
  const lines = result.items.map(
    (item) =>
      `${item.id}  [${item.kind}]${item.verified ? ' ✓' : ''}\n    ${item.name} — ${item.summary}`,
  )
  return `${result.total} result(s):\n\n${lines.join('\n')}`
}

function renderShow(value: unknown): string {
  const detail = value as {
    id: string
    kind: string
    name: string
    summary: string
    source: string
    commands: string[]
    warnings: string[]
    requiresBuildAllowance: boolean
  }
  const parts = [
    `${detail.name} (${detail.id}) — ${detail.kind}`,
    detail.summary,
    `Source: ${detail.source}`,
    '',
    'Installing would run:',
    ...detail.commands.map((command) => `  ${command}`),
  ]
  if (detail.requiresBuildAllowance) {
    parts.push('', 'This package builds from source at install time — it needs explicit consent.')
  }
  return parts.join('\n')
}

function renderInstall(value: unknown): string {
  const outcome = value as {
    artifactId: string
    steps: { summary: string; applied: boolean }[]
    credentialsNeeded: string[]
    restartRequired: boolean
  }
  const lines = [`Installed ${outcome.artifactId}:`]
  for (const step of outcome.steps) {
    lines.push(`  ${step.applied ? '✓' : '·'} ${step.summary}`)
  }
  if (outcome.credentialsNeeded.length > 0) {
    lines.push(`Set before use: ${outcome.credentialsNeeded.join(', ')}`)
  }
  if (outcome.restartRequired) {
    lines.push('Restart the harness for the new rows to load.')
  }
  return lines.join('\n')
}

function renderAccount(value: unknown): string {
  const state = value as {
    action: string
    signedIn: boolean
    account?: string
    status?: string
    userCode?: string
    verificationUri?: string
  }
  if (state.action === 'logout') return 'Signed out of dsh.fish on this machine.'
  if (state.status === 'authorization_pending' && state.userCode && state.verificationUri) {
    return `Open ${state.verificationUri} and enter ${state.userCode}, then run hub_account with action "login" again.`
  }
  if (!state.signedIn) return 'Not signed in to dsh.fish. Run hub_account with action "login".'
  return `Signed in to dsh.fish as ${state.account ?? 'this account'}.`
}

export { HubError, InstallRefused, resolveProfile }
