import { describe, expect, it } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import { githubSource, npmSource } from '../../domain/artifact/source-ref.js'
import { buildMarketIndex, GetMarketIndex, toMarketPlugin } from './get-market-index.js'

const UPDATED_AT = new Date('2025-06-01T12:00:00.000Z')
const FULL_COMMIT = 'a'.repeat(40)

function bundle(
  id: string,
  overrides: {
    readonly source?: Artifact['source']
    readonly sourceCommitSha?: string
    readonly kind?: 'bundle' | 'profile' | 'skill' | 'agent-preset'
    readonly categories?: readonly string[]
    readonly author?: { name: string; url?: string }
  } = {},
): Artifact {
  const kind = overrides.kind ?? 'bundle'
  const payload =
    kind === 'profile'
      ? { kind: 'profile' as const, bundles: ['dsh-better-sidebar'] }
      : kind === 'skill'
        ? {
            kind: 'skill' as const,
            skillName: id,
            layout: 'flat' as const,
            files: [{ path: 'SKILL.md', downloadUrl: 'https://dsh.fish/s.md' }],
          }
        : kind === 'agent-preset'
          ? {
              kind: 'agent-preset' as const,
              presetId: id,
              compositionUrl: 'https://dsh.fish/p.yml',
            }
          : { kind: 'bundle' as const, requiresBuild: false }

  return Artifact.create({
    id,
    kind,
    displayName: id,
    summary: 'A bundle for testing.',
    source: overrides.source ?? npmSource(id, '1.2.3'),
    payload,
    updatedAt: UPDATED_AT,
    ...(overrides.sourceCommitSha === undefined
      ? {}
      : { sourceCommitSha: overrides.sourceCommitSha }),
    ...(overrides.categories === undefined ? {} : { categories: overrides.categories }),
    ...(overrides.author === undefined ? {} : { author: overrides.author }),
  })
}

describe('toMarketPlugin', () => {
  it('renders an npm bundle as one installable version', () => {
    const plugin = toMarketPlugin(bundle('dsh-postgres-mcp'))

    expect(plugin?.name).toBe('dsh-postgres-mcp')
    expect(plugin?.versions).toHaveLength(1)
    expect(plugin?.versions[0]).toEqual({
      version: '1.2.3',
      publishTimestamp: Math.floor(UPDATED_AT.getTime() / 1000),
      source: { type: 'npm' },
      engines: { dsh: '>=0.2.1-rc.2' },
    })
    expect(plugin?.homepage).toBe('https://dsh.fish/a/dsh-postgres-mcp')
  })

  it('pins a git bundle to its commit under a non-release version', () => {
    const plugin = toMarketPlugin(
      bundle('sidebar', {
        source: githubSource({ owner: 'acme', repo: 'sidebar', path: 'packages/sidebar' }),
        sourceCommitSha: FULL_COMMIT,
      }),
    )

    expect(plugin?.versions[0]?.source).toEqual({
      type: 'git',
      url: 'https://github.com/acme/sidebar',
      commit: FULL_COMMIT,
      path: 'packages/sidebar',
    })
    // Not a published release: the commit is the only identity we have, and
    // the version must still be exact SemVer.
    expect(plugin?.versions[0]?.version).toBe(`0.0.0-commit.${FULL_COMMIT.slice(0, 12)}`)
    expect(plugin?.repository).toEqual({
      url: 'https://github.com/acme/sidebar',
      directory: 'packages/sidebar',
    })
  })

  it('withholds a git bundle whose commit is unknown', () => {
    // DSH's format requires a full 40-hex commit. Offering an unpinned install
    // would be the supply-chain risk the install plan already warns about.
    expect(
      toMarketPlugin(bundle('sidebar', { source: githubSource({ owner: 'acme', repo: 's' }) })),
    ).toBeUndefined()
  })

  it('withholds a git bundle pinned to a short SHA', () => {
    expect(
      toMarketPlugin(
        bundle('sidebar', {
          source: githubSource({ owner: 'acme', repo: 's' }),
          sourceCommitSha: 'abc1234',
        }),
      ),
    ).toBeUndefined()
  })

  it('withholds kinds the market cannot install', () => {
    // Skills and agent presets are files, not packages; format 1 has no way to
    // express "write this file", so listing them would advertise a broken install.
    for (const kind of ['skill', 'agent-preset'] as const) {
      expect(toMarketPlugin(bundle(`x-${kind}`, { kind }))).toBeUndefined()
    }
  })

  it('lists a profile, which the launcher installs package by package', () => {
    expect(toMarketPlugin(bundle('my-profile', { kind: 'profile' }))?.versions).toHaveLength(1)
  })

  it('carries the display fields a market card renders', () => {
    const plugin = toMarketPlugin(
      bundle('dsh-postgres-mcp', {
        categories: ['dev'],
        author: { name: 'Acme' },
      }),
    )

    expect(plugin?.title).toEqual({ en: 'dsh-postgres-mcp' })
    expect(plugin?.description).toEqual({ en: 'A bundle for testing.' })
    expect(plugin?.author).toBe('Acme')
    expect(plugin?.metadata.category).toBe('dev')
  })
})

describe('buildMarketIndex', () => {
  it('declares every category its plugins use', () => {
    const index = buildMarketIndex([
      bundle('a', { categories: ['dev'] }),
      bundle('b', { categories: ['dev', 'docs'] }),
    ])

    expect(index.format).toBe(1)
    expect(Object.keys(index.metadata.categories)).toEqual(['dev', 'docs'])
    expect(index.metadata.categories['dev']).toEqual({ title: { en: 'Dev' } })
  })

  it('omits artifacts it cannot install and keeps the rest', () => {
    const index = buildMarketIndex([
      bundle('installable'),
      bundle('a-skill', { kind: 'skill' }),
      bundle('unpinned', { source: githubSource({ owner: 'acme', repo: 's' }) }),
    ])

    expect(index.plugins.map((plugin) => plugin.name)).toEqual(['installable'])
  })

  it('produces no plugins for an empty catalog', () => {
    const index = buildMarketIndex([])
    expect(index.plugins).toEqual([])
    expect(index.metadata.categories).toEqual({})
  })
})

describe('GetMarketIndex', () => {
  it('renders the same rows the catalog snapshot reads', async () => {
    const rows = [bundle('a'), bundle('b')]
    let reads = 0
    const repository = {
      listForSnapshot: async () => {
        reads += 1
        return rows
      },
    } as unknown as ArtifactRepository

    const index = await new GetMarketIndex(repository).index()

    expect(reads).toBe(1)
    expect(index.plugins.map((plugin) => plugin.name)).toEqual(['a', 'b'])
  })
})
