import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepoProber } from './repo-prober.js'
import type { RepoDescriptor } from './repo-prober.js'

/**
 * The prober's classification contract: a repository is what it contains, a
 * submission's kind hint may reorder the probes but never replace their proof.
 */

const SKILL_MD = `---
name: pg-schema-diff
description: Diff two postgres schemas and explain what changed.
---

# Body
`

function descriptor(): RepoDescriptor {
  return {
    full_name: 'acme/widgets',
    name: 'widgets',
    owner: { id: 42, login: 'acme', html_url: 'https://github.com/acme', avatar_url: '' },
    description: 'Widgets.',
    stargazers_count: 3,
    license: null,
    topics: ['dsh-plugin'],
    default_branch: 'main',
    pushed_at: '2026-01-01T00:00:00Z',
    archived: false,
  }
}

/** A GitHub raw-content host serving one repository's files. Returns the requested URLs. */
function stubRawHost(files: Record<string, string>): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)

    if (url.includes('/graphql')) {
      return Response.json({
        data: { repository: { usesCustomOpenGraphImage: false, openGraphImageUrl: '' } },
      })
    }

    if (url.includes('/commits/')) {
      return Response.json({ sha: 'c0ffee'.padEnd(40, '0') })
    }

    const raw = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/)
    if (raw) {
      const body = files[raw[1] ?? '']
      return body === undefined ? new Response('Not Found', { status: 404 }) : new Response(body)
    }

    return new Response('Not Found', { status: 404 })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RepoProber.indexRepository', () => {
  it('does not index a package.json that only declares a retired hub kind', async () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'dsh-github-mcp',
        version: '0.1.0',
        description: 'GitHub over MCP.',
        dsh: {
          hub: {
            kind: 'mcp-server',
            mcp: {
              serverName: 'github',
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
            },
          },
        },
      }),
    }
    stubRawHost(files)

    expect(await new RepoProber().indexRepository(descriptor())).toBeUndefined()
  })

  it('does not index a package.json that only declares a hook-bridge', async () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'dsh-claude-hooks',
        version: '0.1.0',
        dsh: {
          hub: { kind: 'hook-bridge', hook: { dialect: 'claude-code', settingsPath: 'hooks.json' } },
        },
      }),
    }
    stubRawHost(files)

    expect(await new RepoProber().indexRepository(descriptor())).toBeUndefined()
  })

  it('lets a kind hint reorder the probes without replacing their proof', async () => {
    // A repository that is both a bundle and a skill: the manifest probe wins
    // by default, because the harness activates the package's own layer.
    const files = {
      'package.json': JSON.stringify({
        name: 'dsh-pg-tools',
        version: '0.1.0',
        dsh: { bundle: {} },
      }),
      'SKILL.md': SKILL_MD,
    }
    stubRawHost(files)

    const prober = new RepoProber()
    const unhinted = await prober.indexRepository(descriptor())
    const hinted = await prober.indexRepository(descriptor(), undefined, 'skill')

    expect(unhinted?.kind).toBe('bundle')
    expect(hinted).toMatchObject({ kind: 'skill', displayName: 'pg-schema-diff' })
  })

  it('reads the hinted probe first, and falls through when it finds nothing', async () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'dsh-pg-tools',
        version: '0.1.0',
        dsh: { bundle: {} },
      }),
    }
    const calls = stubRawHost(files)

    const snapshot = await new RepoProber().indexRepository(descriptor(), undefined, 'skill')

    expect(snapshot?.kind).toBe('bundle')
    // SKILL.md was probed before package.json, and the missing skill did not
    // stop the manifest probe from proving the bundle.
    expect(calls[0]).toBe('https://raw.githubusercontent.com/acme/widgets/main/SKILL.md')
    expect(calls[1]).toBe('https://raw.githubusercontent.com/acme/widgets/main/package.json')
  })

  it('falls through a retired hub kind to a skill the repository also holds', async () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'dsh-bad-mcp',
        version: '0.1.0',
        dsh: { hub: { kind: 'mcp-server', mcp: { serverName: 'github', transport: 'stdio' } } },
      }),
      'SKILL.md': SKILL_MD,
    }
    stubRawHost(files)

    const snapshot = await new RepoProber().indexRepository(descriptor())
    expect(snapshot?.kind).toBe('skill')
  })

  it('files a row under a curated-list category when the author declared none', async () => {
    stubRawHost({
      'package.json': JSON.stringify({
        name: 'dsh-hud',
        version: '0.1.0',
        description: 'A thing that does something.',
        dsh: { bundle: {} },
      }),
    })

    const snapshot = await new RepoProber().indexRepository(descriptor(), undefined, undefined, [
      'memory',
    ])

    expect(snapshot?.categories).toEqual(['memory'])
  })

  it('records a verified npm binding when the packument repository matches', async () => {
    stubRawHost({
      'package.json': JSON.stringify({
        name: 'dsh-hud',
        version: '0.1.0',
        dsh: { bundle: {} },
      }),
    })

    const snapshot = await new RepoProber(undefined, undefined, async () => ({
      packageName: 'dsh-hud',
      latestVersion: '0.1.0',
    })).indexRepository(descriptor())

    expect(snapshot?.source).toMatchObject({
      origin: 'github',
      owner: 'acme',
      repo: 'widgets',
      npm: { packageName: 'dsh-hud', latestVersion: '0.1.0' },
    })
  })

  it('records a same-repo Release tarball from the curated list', async () => {
    stubRawHost({
      'package.json': JSON.stringify({
        name: 'dsh-hud',
        version: '0.1.0',
        dsh: { bundle: {} },
      }),
    })
    const tarball = 'https://github.com/acme/widgets/releases/download/v0.1.0/hud.tgz'

    const snapshot = await new RepoProber(undefined, undefined, async () => undefined).indexRepository(
      descriptor(),
      undefined,
      undefined,
      [],
      { tarball },
    )

    expect(snapshot?.source).toMatchObject({ origin: 'github', releaseTarball: tarball })
  })

  it('drops a tarball that is not this repository', async () => {
    stubRawHost({
      'package.json': JSON.stringify({
        name: 'dsh-hud',
        version: '0.1.0',
        dsh: { bundle: {} },
      }),
    })

    const snapshot = await new RepoProber(undefined, undefined, async () => undefined).indexRepository(
      descriptor(),
      undefined,
      undefined,
      [],
      { tarball: 'https://github.com/evil/repo/releases/download/v1/p.tgz' },
    )

    expect(snapshot?.source.origin === 'github' && snapshot.source.releaseTarball).toBeUndefined()
  })
})
