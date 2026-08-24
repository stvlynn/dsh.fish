/**
 * dsh.fish inside the harness.
 *
 * Registers search, show, install, list, remove, update and account tools on
 * `ctx.tools`, so an agent can find an artifact and put it on the machine
 * without the user leaving their session. The hub resolves
 * *what* to do — the same install plan the website renders — and this plugin
 * decides whether to do it, because it is the side that bears the consequences.
 *
 * @module @dsh-fish/hub
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config, DEFAULT_CONFIG, type Config as HubConfig } from './config.js'
import { HubClient, HubError } from './hub-client.js'
import type { ArtifactReviews } from './hub-client.js'
import { registerHttpApi } from './http.js'
import { InstallRefused, PlanInstaller } from './installer.js'
import { resolveProfile } from './profile.js'
import { renderArtifactReviews } from './review-text.js'
import { clearToken, readToken } from './token-store.js'

export const name = '@dsh-fish/hub'
export const inject = ['tools']
export { Config, DEFAULT_CONFIG }
export type { HubConfig }

const KINDS = [
  'bundle',
  'profile',
  'skill',
  'mcp-server',
  'agent-preset',
  'hook-bridge',
] as const

export function apply(ctx: Context, config: HubConfig = DEFAULT_CONFIG): void {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const client = new HubClient(baseUrl)
  const profile = resolveProfile(config.targetProfile)
  const installer = new PlanInstaller(client, profile)

  registerHttpApi(ctx, { client, installer, baseUrl, profile })

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
      name: 'hub_list',
      description:
        'List artifacts this machine installed through dsh.fish (the hub plugin or the CLI). ' +
        'Ids can be passed to hub_remove or hub_update.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderList(value) }],
      },
      async execute() {
        const items = await installer.list()
        return {
          profile,
          items: items.map((item) => ({
            id: item.artifactId,
            kind: item.kind,
            installedAt: item.installedAt,
            files: item.files,
            packages: item.packages.map((pkg) => pkg.name),
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_remove',
      description:
        'Uninstall a dsh.fish artifact this machine previously installed. Reverses the recorded ' +
        'files, profile patch rows and package-manager adds. Restart the harness afterwards.',
      parameters: {
        artifactId: { type: 'string', required: true, description: 'Id from hub_list or hub_search.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderRemove(value) }],
      },
      async execute(args, exec) {
        const outcome = await installer.remove(args.artifactId, { signal: exec.signal })
        return {
          artifactId: outcome.artifactId,
          steps: outcome.steps.map((step) => ({
            summary: step.summary,
            applied: step.applied,
            ...(step.detail === undefined ? {} : { detail: step.detail }),
          })),
          restartRequired: outcome.restartRequired,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_update',
      description:
        'Re-apply the current install plan for an artifact already on this machine. File steps ' +
        'overwrite; patch rows are replaced. Build-from-source packages still need explicit consent.',
      parameters: {
        artifactId: { type: 'string', required: true, description: 'Id from hub_list.' },
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
      async execute(args, exec) {
        const installed = (await installer.list()).some((item) => item.artifactId === args.artifactId)
        if (!installed) {
          throw new InstallRefused(
            `Nothing installed as ${args.artifactId} in profile ${profile}.`,
            'NOT_INSTALLED',
          )
        }
        const plan = await client.installPlan({
          artifactId: args.artifactId,
          profile,
          record: true,
        })
        const outcome = await installer.apply(plan, {
          allowBuildScripts: args.allowBuildScripts === true,
          signal: exec.signal,
          replaceExisting: true,
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
        'OAuth device flow: it returns a short code and a URL for the user to open in a browser. ' +
        'Show both to the user and tell them to approve there — you cannot approve it yourself.',
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

        // Login. The grant is returned to the model so it can show the user the
        // code and the URL; the poll then blocks until they approve in a browser.
        const grant = await client.requestDeviceCode()
        ctx.logger?.info?.(
          `dsh.fish: open ${grant.verification_uri_complete ?? grant.verification_uri} and enter ${grant.user_code}`,
        )
        const token = await client.pollForToken(grant, exec.signal)
        const me = await client.whoami()
        return {
          action,
          signedIn: true,
          ...(me.account === null ? {} : { account: me.account.displayName }),
          obtainedAt: token.obtainedAt,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_reviews',
      description:
        'Read dsh.fish community ratings for one artifact: the site uses a 1–5 star scale ' +
        '(1 = broken or misleading, 2 = poor, 3 = works with real caveats, 4 = good, 5 = ' +
        'excellent). Returns the average, how many accounts rated, the 5-to-1 distribution, ' +
        'and the most recent comments. Call this before recommending an artifact, and before ' +
        'hub_rate if you want context on what others experienced. Anonymous — no sign-in needed.',
      parameters: {
        artifactId: { type: 'string', required: true, description: 'Id from hub_search or hub_list.' },
        limit: { type: 'integer', description: 'Maximum recent reviews to return (default 20).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          { type: 'text', text: renderArtifactReviews(value as ArtifactReviews) },
        ],
      },
      async execute(args) {
        return client.reviews({
          artifactId: args.artifactId,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'hub_rate',
      description:
        'Rate a dsh.fish artifact on the site’s 1–5 star scale (1 = broken or misleading, ' +
        '2 = poor, 3 = works with real caveats, 4 = good, 5 = excellent), optionally with a ' +
        'comment shown publicly on the artifact’s page. Rate only an artifact this machine ' +
        'actually installed (check with hub_list) and only from firsthand evidence — a run ' +
        'that worked, a failure you saw, documentation that misled you. Never fabricate ' +
        'experience, and never rate without telling the user you are doing it; when an install ' +
        'or usage clearly succeeded or failed, offer to leave the rating. A comment should say ' +
        'what it was used for and what specifically worked or broke. Rating again overwrites ' +
        'the previous rating from this account. Requires sign-in (hub_account action "login"). ' +
        'Returns the fresh aggregate, so you can show the user their rating landing.',
      parameters: {
        artifactId: { type: 'string', required: true, description: 'Id from hub_list or hub_search.' },
        rating: {
          type: 'integer',
          required: true,
          description: 'Whole stars from 1 to 5 on the site scale.',
        },
        comment: {
          type: 'string',
          description: 'Optional public comment, up to 2000 characters. Specific, factual, firsthand.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: renderRate(value) }],
      },
      async execute(args) {
        try {
          return await client.rate({
            artifactId: args.artifactId,
            rating: args.rating,
            ...(args.comment === undefined ? {} : { comment: args.comment }),
          })
        } catch (error) {
          if (error instanceof HubError && error.code === 'UNAUTHENTICATED') {
            throw new HubError(
              'Not signed in to dsh.fish. Run hub_account with action "login" first — the user must approve in a browser.',
              'UNAUTHENTICATED',
            )
          }
          throw error
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

function renderList(value: unknown): string {
  const result = value as {
    profile: string
    items: { id: string; kind: string; installedAt: string }[]
  }
  if (result.items.length === 0) {
    return `No dsh.fish artifacts installed in profile ${result.profile}.`
  }
  const lines = result.items.map((item) => `${item.id}  [${item.kind}]  ${item.installedAt}`)
  return `Installed in ${result.profile}:\n\n${lines.join('\n')}`
}

function renderRemove(value: unknown): string {
  const outcome = value as {
    artifactId: string
    steps: { summary: string; applied: boolean }[]
    restartRequired: boolean
  }
  const lines = [`Removed ${outcome.artifactId}:`]
  for (const step of outcome.steps) {
    lines.push(`  ${step.applied ? '✓' : '·'} ${step.summary}`)
  }
  if (outcome.restartRequired) {
    lines.push('Restart the harness for the removal to take effect.')
  }
  return lines.join('\n')
}

function renderAccount(value: unknown): string {
  const state = value as { action: string; signedIn: boolean; account?: string }
  if (state.action === 'logout') return 'Signed out of dsh.fish on this machine.'
  if (!state.signedIn) return 'Not signed in to dsh.fish. Run hub_account with action "login".'
  return `Signed in to dsh.fish as ${state.account ?? 'this account'}.`
}

function renderRate(value: unknown): string {
  const reviews = value as ArtifactReviews
  return `Rating recorded.\n${renderArtifactReviews(reviews)}`
}

export { HubError, InstallRefused }
