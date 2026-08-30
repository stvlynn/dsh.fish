import { afterEach, describe, expect, it, vi } from 'vitest'
import { AWESOME_LISTS, AwesomeListIndexer } from './awesome-list-indexer.js'
import type { AwesomeList } from './awesome-list-indexer.js'
import type { ListCursor, ListPosition } from './list-cursor.js'
import { RepoProber } from './repo-prober.js'

/**
 * The curated-list crawl, asserted on the two real catalog shapes: a trimmed
 * `awesome-dsh-plugin` `docs/plugins.json` and a trimmed Oh-My-DSH
 * `data/plugins.json`, both captured from the live documents. The fixtures
 * stay close to the originals — including the entries that are applications
 * or collections rather than plugins — because the manifest gate absorbing
 * them is the whole point of the source.
 */

interface RepoStub {
  owner: string
  name: string
  description?: string
  topics?: string[]
  files?: Record<string, string>
}

/** awesome-dsh-plugin's shape: `plugins[]`, one `url` each. */
const AWESOME_FIXTURE = {
  name: 'awesome-dsh-plugin',
  url: 'https://beancookie.github.io/awesome-dsh-plugin',
  updated: '2026-08-18',
  count: 3,
  categories: { ui: { zh: 'UI 增强', en: 'UI Enhancements' } },
  plugins: [
    {
      name: 'dsh-hud',
      owner: 'acme',
      url: 'https://github.com/acme/dsh-hud',
      category: 'ui',
      description: { zh: 'HUD 状态面板', en: 'HUD status panel' },
      npm: null,
      stars: 6,
      createdAt: '2026-08-14',
      install: 'dsh plugin --profile web add github:acme/dsh-hud',
      added: '2026-08-14',
    },
    {
      name: 'dsh-spotlight',
      owner: 'acme',
      url: 'https://github.com/acme/dsh-spotlight',
      category: 'ui',
      description: { zh: '命令面板', en: 'Keyboard-first command palette.' },
      npm: null,
      stars: 7,
      createdAt: '2026-08-13',
      install: 'dsh plugin --profile web add github:acme/dsh-spotlight',
      added: '2026-08-13',
    },
    {
      // A duplicate with different casing and a trailing `.git`, as upstream
      // edits produce: one repository, one probe.
      name: 'dsh-hud-again',
      owner: 'ACME',
      url: 'https://github.com/ACME/dsh-hud.git',
      category: 'ui',
      description: { zh: '', en: 'Duplicate entry.' },
      npm: null,
      stars: 6,
      createdAt: '2026-08-14',
      install: 'dsh plugin --profile web add github:acme/dsh-hud',
      added: '2026-08-14',
    },
  ],
}

/** Oh-My-DSH's shape: `items[]`, applications and collections included. */
const OH_MY_DSH_FIXTURE = {
  generated_at: '2026-08-18T12:52:49.902684+08:00',
  count: 3,
  items: [
    {
      full_name: 'acme/pg-tools',
      url: 'https://github.com/acme/pg-tools',
      description: 'Postgres tooling for the harness.',
      stars: 42,
      forks: 3,
      language: 'TypeScript',
      topics: ['dsh-plugin'],
      archived: false,
      fork: false,
      pushed_at: '2026-08-17T12:01:58Z',
      created_at: '2026-04-28T04:25:20Z',
      license: 'MIT',
      owner: 'acme',
      homepage: '',
      category: 'agent',
      note: '',
      source: 'auto',
      activity: '🟢 活跃',
      type: '插件',
    },
    {
      // Listed, but an application: the harness would load nothing from it.
      full_name: 'acme/a-web-app',
      url: 'https://github.com/acme/a-web-app',
      description: 'An application that merely mentions the harness.',
      stars: 9,
      forks: 1,
      language: 'TypeScript',
      topics: ['dsh-plugin'],
      archived: false,
      fork: false,
      pushed_at: '2026-08-17T12:01:58Z',
      created_at: '2026-08-13T11:56:32Z',
      license: 'MIT',
      owner: 'acme',
      homepage: '',
      category: 'eco',
      note: '',
      source: 'topic',
      activity: '🟢 活跃',
      type: '项目',
    },
    {
      // Not a GitHub repository at all; ignored without a probe.
      full_name: 'acme/elsewhere',
      url: 'https://example.com/acme/elsewhere',
      description: 'Hosted somewhere else.',
      stars: 1,
      forks: 0,
      language: null,
      topics: [],
      archived: false,
      fork: false,
      pushed_at: '2026-08-17T12:01:58Z',
      created_at: '2026-08-13T11:56:32Z',
      license: null,
      owner: 'acme',
      homepage: '',
      category: 'eco',
      note: '',
      source: 'auto',
      activity: '🟢 活跃',
      type: '项目',
    },
  ],
}

const AWESOME_URL = 'https://lists.test/awesome-dsh-plugin.json'
const OH_MY_DSH_URL = 'https://lists.test/oh-my-dsh.json'

/** The production extractors, pointed at fixture URLs. */
function testLists(): readonly AwesomeList[] {
  const [awesome, ohMyDsh] = AWESOME_LISTS
  return [
    { ...awesome!, url: AWESOME_URL },
    { ...ohMyDsh!, url: OH_MY_DSH_URL },
  ]
}

const BUNDLE_MANIFEST = JSON.stringify({
  name: 'dsh-hud',
  version: '0.1.0',
  description: 'HUD status panel',
  dsh: { bundle: {} },
})

const SKILL_MD = `---
name: pg-schema-diff
description: Diff two postgres schemas and explain what changed.
---

# Body
`

function repoDescriptor(repo: RepoStub) {
  return {
    full_name: `${repo.owner}/${repo.name}`,
    name: repo.name,
    owner: {
      id: 42,
      login: repo.owner,
      html_url: `https://github.com/${repo.owner}`,
      avatar_url: '',
    },
    description: repo.description ?? null,
    stargazers_count: 7,
    license: null,
    topics: repo.topics ?? [],
    default_branch: 'main',
    pushed_at: '2026-01-01T00:00:00Z',
    archived: false,
  }
}

/**
 * Lists and GitHub stood up out of stubs. Returns the recorded request URLs
 * so a test can assert on what was probed — and on what was not, which is
 * where the budget lives.
 */
function stubSources(repos: RepoStub[], listBodies: Record<string, unknown>) {
  const calls: string[] = []
  const byRepo = new Map<string, RepoStub>()
  for (const repo of repos) byRepo.set(`${repo.owner}/${repo.name}`.toLowerCase(), repo)

  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)

    const listBody = listBodies[url]
    if (listBody !== undefined) return Response.json(listBody)

    if (url.includes('/graphql')) {
      return Response.json({
        data: {
          repository: {
            usesCustomOpenGraphImage: false,
            openGraphImageUrl: 'https://avatars.githubusercontent.com/u/42',
          },
        },
      })
    }

    const commit = url.match(/repos\/([^/]+)\/([^/]+)\/commits\//)
    if (commit) return Response.json({ sha: 'c0ffee'.padEnd(40, '0') })

    const meta = url.match(/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/)
    if (meta) {
      const repo = byRepo.get(`${meta[1]}/${meta[2]}`.toLowerCase())
      return repo === undefined
        ? new Response('Not Found', { status: 404 })
        : Response.json(repoDescriptor(repo))
    }

    const raw = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/)
    if (raw) {
      const body = byRepo.get(`${raw[1]}/${raw[2]}`.toLowerCase())?.files?.[raw[3] ?? '']
      return body === undefined ? new Response('Not Found', { status: 404 }) : new Response(body)
    }

    return new Response('Not Found', { status: 404 })
  })

  return calls
}

function memoryCursor(stored?: ListPosition) {
  const written: ListPosition[] = []
  const cursor: ListCursor = {
    read: async () => stored,
    write: async (next: ListPosition) => {
      written.push(next)
      stored = next
    },
  }
  return { cursor, written }
}

function indexer(cursor?: ListCursor): AwesomeListIndexer {
  return new AwesomeListIndexer(new RepoProber(), cursor, testLists())
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AWESOME_LISTS', () => {
  it('reads the live awesome-dsh-plugin.com registry, not a fork', () => {
    expect(AWESOME_LISTS[0]?.url).toBe('https://awesome-dsh-plugin.com/plugins.json')
  })
})

describe('AwesomeListIndexer', () => {
  it('attaches a curated Release tarball that belongs to the listed repository', async () => {
    const tarball = 'https://github.com/acme/dsh-hud/releases/download/v0.1.0/hud.tgz'
    stubSources(
      [{ owner: 'acme', name: 'dsh-hud', files: { 'package.json': BUNDLE_MANIFEST } }],
      {
        [AWESOME_URL]: {
          plugins: [
            {
              url: 'https://github.com/acme/dsh-hud',
              category: 'ui',
              tarball,
            },
          ],
        },
      },
    )

    const snapshots = await new AwesomeListIndexer(
      new RepoProber(undefined, undefined, async () => undefined),
      undefined,
      testLists(),
    ).discover(1)

    expect(snapshots[0]?.source).toMatchObject({
      origin: 'github',
      repo: 'dsh-hud',
      via: ['awesome-dsh-plugin'],
      releaseTarball: tarball,
    })
  })

  it('probes a repository listed by awesome-dsh-plugin and records the provenance', async () => {
    stubSources(
      [{ owner: 'acme', name: 'dsh-hud', files: { 'package.json': BUNDLE_MANIFEST } }],
      { [AWESOME_URL]: AWESOME_FIXTURE, [OH_MY_DSH_URL]: OH_MY_DSH_FIXTURE },
    )

    const snapshots = await indexer().discover(1)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      id: 'dsh-hud',
      kind: 'bundle',
      categories: ['ui'],
      source: { origin: 'github', owner: 'acme', repo: 'dsh-hud', via: ['awesome-dsh-plugin'] },
    })
  })

  it('reads Oh-My-DSH items and gates them on a loadable manifest', async () => {
    const calls = stubSources(
      [
        { owner: 'acme', name: 'pg-tools', files: { 'SKILL.md': SKILL_MD } },
        { owner: 'acme', name: 'a-web-app', files: { 'README.md': '# app' } },
      ],
      { [AWESOME_URL]: { plugins: [] }, [OH_MY_DSH_URL]: OH_MY_DSH_FIXTURE },
    )

    const snapshots = await indexer().discover(10)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      id: 'acme-pg-schema-diff',
      kind: 'skill',
      // Oh-My-DSH files this under `agent`, which aliases onto `tools`.
      categories: ['tools'],
      source: { origin: 'github', via: ['oh-my-dsh'] },
    })
    // The application entry was probed for exactly the three manifests and
    // nothing more — same cost as a topic repository that is not a plugin.
    expect(
      calls.filter((url) => url.includes('raw.githubusercontent.com/acme/a-web-app')),
    ).toEqual([
      'https://raw.githubusercontent.com/acme/a-web-app/main/package.json',
      'https://raw.githubusercontent.com/acme/a-web-app/main/SKILL.md',
      'https://raw.githubusercontent.com/acme/a-web-app/main/agent.cordis.yml',
    ])
    // The non-GitHub entry was never probed at all.
    expect(calls.some((url) => url.includes('example.com'))).toBe(false)
    expect(calls.some((url) => url.includes('/repos/acme/elsewhere'))).toBe(false)
  })

  it('never probes the same repository twice in one run', async () => {
    const calls = stubSources(
      [{ owner: 'acme', name: 'dsh-hud', files: { 'package.json': BUNDLE_MANIFEST } }],
      { [AWESOME_URL]: AWESOME_FIXTURE },
    )

    const snapshots = await indexer().discover(10)

    // Three entries, two of them the same repository: one probe, one row.
    expect(snapshots).toHaveLength(1)
    expect(calls.filter((url) => url.endsWith('/repos/acme/dsh-hud'))).toHaveLength(1)
  })

  it('stops at the caller\'s limit and resumes from the stored offset', async () => {
    stubSources(
      [
        { owner: 'acme', name: 'dsh-hud', files: { 'package.json': BUNDLE_MANIFEST } },
        {
          owner: 'acme',
          name: 'dsh-spotlight',
          files: {
            'package.json': JSON.stringify({
              name: 'dsh-spotlight',
              version: '0.1.0',
              dsh: { bundle: {} },
            }),
          },
        },
      ],
      { [AWESOME_URL]: AWESOME_FIXTURE },
    )
    const { cursor, written } = memoryCursor()

    const first = await indexer(cursor).discover(1)
    expect(first.map((snapshot) => snapshot.id)).toEqual(['dsh-hud'])
    expect(written).toEqual([{ list: 0, offset: 1 }])

    const second = await indexer(cursor).discover(1)
    expect(second.map((snapshot) => snapshot.id)).toEqual(['dsh-spotlight'])
    expect(written[1]).toEqual({ list: 0, offset: 2 })
  })

  it('moves on to the next list when one runs out', async () => {
    stubSources(
      [
        { owner: 'acme', name: 'dsh-hud', files: { 'package.json': BUNDLE_MANIFEST } },
        { owner: 'acme', name: 'pg-tools', files: { 'SKILL.md': SKILL_MD } },
      ],
      {
        [AWESOME_URL]: { ...AWESOME_FIXTURE, plugins: [AWESOME_FIXTURE.plugins[0]] },
        [OH_MY_DSH_URL]: OH_MY_DSH_FIXTURE,
      },
    )
    const { cursor, written } = memoryCursor()

    const snapshots = await indexer(cursor).discover(10)

    // Entries from both lists in one run: exhausting the first list fell
    // through to the second, and exhausting that wrapped the cursor.
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['dsh-hud', 'acme-pg-schema-diff'])
    expect(written.at(-1)).toEqual({ list: 0, offset: 0 })
  })

  it('wraps from the last list back to the first', async () => {
    stubSources(
      [{ owner: 'acme', name: 'dsh-hud', files: { 'package.json': BUNDLE_MANIFEST } }],
      {
        [AWESOME_URL]: { ...AWESOME_FIXTURE, plugins: [AWESOME_FIXTURE.plugins[0]] },
        [OH_MY_DSH_URL]: { items: [] },
      },
    )
    const { cursor, written } = memoryCursor({ list: 1, offset: 0 })

    const snapshots = await indexer(cursor).discover(10)

    // The last list was already swept, so the run wrapped and read the first.
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['dsh-hud'])
    // Sweeping that entry exhausted the first list too, so the cursor sits at
    // the head of the last list again — a full cycle with every row refreshed.
    expect(written.at(-1)).toEqual({ list: 1, offset: 0 })
  })

  it('leaves the cursor alone when the list cannot be fetched', async () => {
    vi.stubGlobal('fetch', async () => new Response('upstream down', { status: 502 }))
    const { cursor, written } = memoryCursor()

    const snapshots = await indexer(cursor).discover(10)

    expect(snapshots).toEqual([])
    expect(written).toEqual([])
  })
})
