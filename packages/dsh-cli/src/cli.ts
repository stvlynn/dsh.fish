/**
 * The dsh.fish CLI — the copy-pasteable half of the install plan.
 *
 * Command names follow the skills CLI (`add`, `find`, `list`, `remove`,
 * `update`, `init`) so a user coming from `npx skills` does not have to learn
 * a second vocabulary. Every mutating command applies the same install plan
 * the website renders and the hub plugin executes.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLI_CLIENT_ID,
  HubClient,
  HubError,
  InstallRefused,
  PlanInstaller,
  clearToken,
  isElectronManagedProfile,
  renderArtifactReviews,
} from '@dsh-fish/hub/install'
import { initSkill } from './init.js'
import { parseArgv, UsageError, type CliFlags, type CliRequest } from './parse-args.js'
import { resolveArtifact } from './resolve-source.js'

const VERSION = readVersion()

/** Commands that reach the package manager, and so need an addressable profile. */
const PACKAGE_COMMANDS = new Set([
  'add',
  'a',
  'install',
  'i',
  'remove',
  'rm',
  'r',
  'update',
  'upgrade',
  'check',
])

const HELP = `
Usage: dsh-fish <command> [options]

Search dsh.fish and install harness artifacts — bundles, profiles, skills
and agent presets — using the same plan the website shows.

Manage artifacts:
  add <source>       Install from a hub id, dsh.fish URL, or owner/repo
  find [query]       Search the catalog (alias: search)
  show <source>      Show one artifact and its install plan
  list               List artifacts this machine installed (alias: ls)
  remove <id>        Uninstall a previously installed artifact (alias: rm)
  update [id]        Re-apply the current plan (all, or one id)
  init [name]        Create a SKILL.md the hub indexer will accept

Account:
  login              Sign in via the OAuth device flow
  logout             Forget the stored token
  whoami             Show who is signed in (alias: status)

Community:
  rate <source> <1-5> [comment...]
                     Rate an artifact on the site's 1–5 scale; rating again
                     replaces your previous rating. Needs login first
  reviews <source>   Show an artifact's average rating, its 5-to-1
                     distribution, and recent comments

Options:
  --profile, -p      Harness profile (default: $DSH_PROFILE or web).
                     Local DSH boots "local-dsh", not "web"
  --registry         Hub origin (default: $DSH_FISH_URL or https://dsh.fish)
  --kind, -k         Restrict find to one artifact kind
  --allow-build-scripts
                     Permit a git package to run its prepare script
  --json             Machine-readable output
  --yes, -y          Skip confirmation prompts (does not grant build scripts)
  --help, -h         Show this help
  --version, -v      Show version

Examples:
  npx @dsh-fish/cli add release-notes
  npx @dsh-fish/cli add https://dsh.fish/a/release-notes --profile web
  npx @dsh-fish/cli add release-notes --profile local-dsh
  DSH_PROFILE=local-dsh npx @dsh-fish/cli list
  npx @dsh-fish/cli find postgres --kind bundle
  npx @dsh-fish/cli list
  npx @dsh-fish/cli remove release-notes
  npx @dsh-fish/cli rate dsh-postgres-mcp 5 "installed and queried in minutes"
  npx @dsh-fish/cli reviews dsh-postgres-mcp
`.trim()

async function main(): Promise<void> {
  let request: CliRequest
  try {
    request = parseArgv(process.argv.slice(2))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }

  if (request.flags.version && request.command === '') {
    console.log(VERSION)
    return
  }
  if (request.flags.help || request.command === '' || request.command === 'help') {
    console.log(HELP)
    return
  }
  if (request.flags.version) {
    console.log(VERSION)
    return
  }

  const client = new HubClient(request.flags.registry, CLI_CLIENT_ID)
  const installer = new PlanInstaller(client, request.flags.profile)
  const signal = processSignal()

  // Commands that touch the package manager cannot address the Electron-managed
  // profile, so say so before resolving anything over the network. The
  // installer repeats this check for its other callers (the hub plugin), where
  // the target profile is resolved rather than typed.
  if (PACKAGE_COMMANDS.has(request.command) && isElectronManagedProfile(request.flags.profile)) {
    console.error(
      `The DeepSeek Harness Desktop application owns profile "${request.flags.profile}" and ` +
        'does not let a separate process install into it. Run the install from inside that ' +
        'app instead — ask its agent to use hub_install, or use the dsh.fish section in ' +
        'Settings — where the harness manages its own profile. This CLI can target any ' +
        'profile a terminal launcher owns, such as web.',
    )
    process.exitCode = 1
    return
  }

  try {
    switch (request.command) {
      case 'add':
      case 'a':
      case 'install':
      case 'i':
        await runAdd(client, installer, request, signal)
        break
      case 'find':
      case 'search':
      case 'f':
      case 's':
        await runFind(client, request)
        break
      case 'show':
        await runShow(client, request)
        break
      case 'list':
      case 'ls':
        await runList(installer, request.flags)
        break
      case 'remove':
      case 'rm':
      case 'r':
        await runRemove(installer, request, signal)
        break
      case 'update':
      case 'upgrade':
      case 'check':
        await runUpdate(client, installer, request, signal)
        break
      case 'login':
        await runLogin(client, signal)
        break
      case 'logout':
        await runLogout()
        break
      case 'whoami':
      case 'status':
        await runWhoami(client, request.flags)
        break
      case 'rate':
        await runRate(client, request)
        break
      case 'reviews':
      case 'review':
        await runReviews(client, request)
        break
      case 'init':
        await runInit(request)
        break
      default:
        console.error(`Unknown command: ${request.command}`)
        console.error('Run dsh-fish --help for usage.')
        process.exitCode = 1
    }
  } catch (error) {
    if (error instanceof HubError || error instanceof InstallRefused || error instanceof UsageError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }
}

async function runAdd(
  client: HubClient,
  installer: PlanInstaller,
  request: CliRequest,
  signal: AbortSignal,
): Promise<void> {
  const source = request.positional[0]
  if (source === undefined) throw new UsageError('add needs an artifact id, URL, or owner/repo.')
  const artifact = await resolveArtifact(client, source)
  const plan = await client.installPlan({
    artifactId: artifact.id,
    profile: request.flags.profile,
    record: true,
  })
  const outcome = await installer.apply(plan, {
    allowBuildScripts: request.flags.allowBuildScripts,
    signal,
  })
  if (request.flags.json) {
    console.log(JSON.stringify({ artifact, outcome }, null, 2))
    return
  }
  console.log(`Installed ${artifact.displayName} (${artifact.id})`)
  for (const step of outcome.steps) {
    console.log(`  ${step.applied ? '✓' : '·'} ${step.summary}`)
  }
  if (outcome.credentialsNeeded.length > 0) {
    console.log(`Set before use: ${outcome.credentialsNeeded.join(', ')}`)
  }
  if (outcome.restartRequired) {
    console.log('Restart the harness for the new rows to load.')
  }
}

async function runFind(client: HubClient, request: CliRequest): Promise<void> {
  const query = request.positional.join(' ')
  const result = await client.search({
    ...(query === '' ? {} : { query }),
    ...(request.flags.kind === undefined ? {} : { kind: request.flags.kind }),
    limit: 20,
  })
  if (request.flags.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.items.length === 0) {
    console.log('No matching artifacts on dsh.fish.')
    return
  }
  console.log(`${result.total} result(s):\n`)
  for (const item of result.items) {
    const mark = item.verified ? ' ✓' : ''
    console.log(`${item.id}  [${item.kind}]${mark}`)
    console.log(`    ${item.displayName} — ${item.summary}`)
  }
}

async function runShow(client: HubClient, request: CliRequest): Promise<void> {
  const source = request.positional[0]
  if (source === undefined) throw new UsageError('show needs an artifact id, URL, or owner/repo.')
  const artifact = await resolveArtifact(client, source)
  const plan = await client.installPlan({
    artifactId: artifact.id,
    profile: request.flags.profile,
    record: false,
  })
  if (request.flags.json) {
    console.log(JSON.stringify({ artifact, plan }, null, 2))
    return
  }
  console.log(`${artifact.displayName} (${artifact.id}) — ${artifact.kind}`)
  console.log(artifact.summary)
  console.log(`Source: ${artifact.sourceUrl}`)
  // Scan provenance: the commit the registry read, so the user can diff what
  // they are about to install against what was actually indexed.
  if (plan.scannedAtCommit !== undefined) {
    console.log(`Indexed at commit: ${plan.scannedAtCommit}`)
  }
  console.log('')
  console.log('Installing would run:')
  for (const command of plan.manualCommands) {
    console.log(`  ${command}`)
  }
}

async function runList(installer: PlanInstaller, flags: CliFlags): Promise<void> {
  const items = await installer.list()
  if (flags.json) {
    console.log(JSON.stringify({ profile: flags.profile, items }, null, 2))
    return
  }
  if (items.length === 0) {
    console.log(`No dsh.fish artifacts installed in profile ${flags.profile}.`)
    return
  }
  console.log(`Installed in ${flags.profile}:\n`)
  for (const item of items) {
    console.log(`${item.artifactId}  [${item.kind}]  ${item.installedAt}`)
  }
}

async function runRemove(
  installer: PlanInstaller,
  request: CliRequest,
  signal: AbortSignal,
): Promise<void> {
  const artifactId = request.positional[0]
  if (artifactId === undefined) throw new UsageError('remove needs an artifact id from `dsh-fish list`.')
  const outcome = await installer.remove(artifactId, { signal })
  if (request.flags.json) {
    console.log(JSON.stringify(outcome, null, 2))
    return
  }
  console.log(`Removed ${outcome.artifactId}:`)
  for (const step of outcome.steps) {
    console.log(`  ${step.applied ? '✓' : '·'} ${step.summary}`)
  }
  if (outcome.restartRequired) {
    console.log('Restart the harness for the removal to take effect.')
  }
}

async function runUpdate(
  client: HubClient,
  installer: PlanInstaller,
  request: CliRequest,
  signal: AbortSignal,
): Promise<void> {
  const installed = await installer.list()
  const wanted = request.positional[0]
  const targets =
    wanted === undefined ? installed : installed.filter((item) => item.artifactId === wanted)
  if (wanted !== undefined && targets.length === 0) {
    throw new InstallRefused(
      `Nothing installed as ${wanted} in profile ${request.flags.profile}.`,
      'NOT_INSTALLED',
    )
  }
  if (targets.length === 0) {
    console.log(`No dsh.fish artifacts installed in profile ${request.flags.profile}.`)
    return
  }
  for (const item of targets) {
    const plan = await client.installPlan({
      artifactId: item.artifactId,
      profile: request.flags.profile,
      record: true,
    })
    const outcome = await installer.apply(plan, {
      allowBuildScripts: request.flags.allowBuildScripts,
      signal,
      replaceExisting: true,
    })
    console.log(`Updated ${item.artifactId}:`)
    for (const step of outcome.steps) {
      console.log(`  ${step.applied ? '✓' : '·'} ${step.summary}`)
    }
  }
}

async function runLogin(client: HubClient, signal: AbortSignal): Promise<void> {
  const grant = await client.requestDeviceCode()
  const url = grant.verification_uri_complete ?? grant.verification_uri
  console.log(`Open ${url}`)
  console.log(`Enter code: ${grant.user_code}`)
  await client.pollForToken(grant, signal)
  const me = await client.whoami()
  console.log(
    me.account === null
      ? 'Signed in to dsh.fish.'
      : `Signed in to dsh.fish as ${me.account.displayName}.`,
  )
}

async function runLogout(): Promise<void> {
  await clearToken()
  console.log('Signed out of dsh.fish on this machine.')
}

async function runWhoami(client: HubClient, flags: CliFlags): Promise<void> {
  const me = await client.whoami()
  if (flags.json) {
    console.log(JSON.stringify(me, null, 2))
    return
  }
  if (me.account === null) {
    console.log('Not signed in to dsh.fish. Run `dsh-fish login`.')
    return
  }
  console.log(`Signed in to dsh.fish as ${me.account.displayName}.`)
}

/**
 * The one catalog write this CLI performs. An agent driving the CLI should
 * only rate what it actually installed and used — the same rule the hub
 * plugin's hub_rate tool states — and say so to its user when it does.
 */
async function runRate(client: HubClient, request: CliRequest): Promise<void> {
  const source = request.positional[0]
  const ratingRaw = request.positional[1]
  if (source === undefined || ratingRaw === undefined) {
    throw new UsageError('rate needs an artifact id and a whole-number rating from 1 to 5.')
  }
  const rating = Number(ratingRaw)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new UsageError('rate needs a whole-number rating from 1 to 5.')
  }
  const comment = request.positional.slice(2).join(' ').trim()
  const artifact = await resolveArtifact(client, source)
  let reviews
  try {
    reviews = await client.rate({
      artifactId: artifact.id,
      rating,
      ...(comment === '' ? {} : { comment }),
    })
  } catch (error) {
    if (error instanceof HubError && error.code === 'UNAUTHENTICATED') {
      throw new HubError('Not signed in to dsh.fish. Run `dsh-fish login` first.', 'UNAUTHENTICATED')
    }
    throw error
  }
  if (request.flags.json) {
    console.log(JSON.stringify(reviews, null, 2))
    return
  }
  console.log(`Rated ${artifact.displayName} (${artifact.id}): ${rating} ★.`)
  console.log(renderArtifactReviews(reviews))
}

async function runReviews(client: HubClient, request: CliRequest): Promise<void> {
  const source = request.positional[0]
  if (source === undefined) throw new UsageError('reviews needs an artifact id, URL, or owner/repo.')
  const artifact = await resolveArtifact(client, source)
  const reviews = await client.reviews({ artifactId: artifact.id })
  if (request.flags.json) {
    console.log(JSON.stringify(reviews, null, 2))
    return
  }
  console.log(renderArtifactReviews(reviews))
}

async function runInit(request: CliRequest): Promise<void> {
  const result = await initSkill(process.cwd(), request.positional[0])
  if (!result.created) {
    console.log(`Skill already exists at ${result.skillFile}`)
    return
  }
  console.log(`Initialized skill: ${result.skillName}`)
  console.log(`Created ${result.skillFile}`)
  console.log('Add the dsh-plugin GitHub topic after you push, and the hub will index it.')
}

function processSignal(): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  return controller.signal
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

await main()
