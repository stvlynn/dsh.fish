import { describe, expect, it } from 'vitest'
import { SubmitArtifact, ownsSource } from './submit-artifact.js'
import type { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import type { Actor } from '../../domain/account/account.js'
import type { Submission, SubmissionRepository } from '../../domain/submission/submission.js'
import { githubSource, npmSource } from '../../domain/artifact/source-ref.js'
import type { Slug } from '../../domain/shared/slug.js'
import type { LinkedIdentityReader } from '../port/linked-identity.js'
import type { IndexedSnapshot, SourceIndexer } from '../port/source-indexer.js'

const GITHUB_USER_ID = '4813851'

function snapshot(overrides: Partial<IndexedSnapshot> = {}): IndexedSnapshot {
  return {
    id: 'dsh-hello-plugin',
    kind: 'bundle',
    displayName: 'dsh-hello-plugin',
    summary: 'A bundle.',
    source: githubSource({ owner: 'ada', repo: 'dsh-hello-plugin' }),
    payload: { kind: 'bundle', requiresBuild: false },
    keywords: [],
    categories: ['git'],
    sourceOwnerId: GITHUB_USER_ID,
    stats: { stars: 0, downloads: 0 },
    ...overrides,
  }
}

/**
 * The auto-approve path publishes without review, so what counts as proof of
 * ownership is a security question, not a convenience one.
 */
describe('ownsSource', () => {
  it('accepts the account the repository belongs to', () => {
    expect(ownsSource(GITHUB_USER_ID, snapshot())).toBe(true)
  })

  it('rejects a different GitHub account', () => {
    expect(ownsSource('999', snapshot())).toBe(false)
  })

  it('rejects an account with no GitHub identity linked', () => {
    // An email-and-password account proves nothing about a repository.
    expect(ownsSource(undefined, snapshot())).toBe(false)
  })

  it('rejects a source whose owner id could not be read', () => {
    expect(ownsSource(GITHUB_USER_ID, snapshot({ sourceOwnerId: undefined }))).toBe(false)
  })

  it('rejects npm, which carries no proof of who published', () => {
    expect(
      ownsSource(GITHUB_USER_ID, {
        source: npmSource('dsh-hello-plugin', '1.0.0'),
        sourceOwnerId: GITHUB_USER_ID,
      }),
    ).toBe(false)
  })
})

function harness(options: { linkedGitHubId?: string; snapshot?: IndexedSnapshot }) {
  const saved: Submission[] = []
  const artifacts: Artifact[] = []
  const localized: string[] = []

  const submissions: SubmissionRepository = {
    findById: async () => undefined,
    listByAccount: async () => [],
    listPending: async () => [],
    findPendingBySource: async () => undefined,
    save: async (submission) => {
      saved.push(submission)
    },
  }
  const artifactRepository: ArtifactRepository = {
    findById: async (_id: Slug) => undefined,
    search: async () => {
      throw new Error('not used')
    },
    readFacetCounts: async () => undefined,
    refreshFacetCounts: async () => {},
    save: async (artifact) => {
      artifacts.push(artifact)
    },
    saveMany: async () => {},
    incrementInstalls: async () => {},
    recordMetricsSnapshot: async () => {},
    listIdsByOrigin: async () => [],
    listForSitemap: async () => {
      throw new Error('not used')
    },
    listForSnapshot: async () => {
      throw new Error('not used')
    },
    catalogStats: async () => {
      throw new Error('not used')
    },
  }
  const indexer: SourceIndexer = {
    origin: 'github',
    discover: async () => [],
    indexOne: async () => options.snapshot ?? snapshot(),
  }
  const identities: LinkedIdentityReader = {
    githubUserId: async () => options.linkedGitHubId,
  }

  const useCase = new SubmitArtifact(
    submissions,
    artifactRepository,
    [indexer],
    { next: () => 'submission-1' },
    identities,
    {
      schedule: async (input) => {
        localized.push(String(input.artifactId))
      },
    },
  )
  const actor: Actor = {
    account: { id: 'account-1', displayName: 'Ada', isAdmin: false },
    channel: 'session',
  }
  return { useCase, actor, saved, artifacts, localized }
}

describe('SubmitArtifact', () => {
  it('publishes immediately for the account that owns the repository', async () => {
    const { useCase, actor, artifacts } = harness({
      linkedGitHubId: GITHUB_USER_ID,
    })

    const result = await useCase.execute(actor, {
      kind: 'bundle',
      sourceSpec: 'github:ada/dsh-hello-plugin',
    })

    expect(result).toMatchObject({
      status: 'approved',
      artifactId: 'dsh-hello-plugin',
    })
    expect(artifacts[0]?.ownerAccountId).toBe('account-1')
  })

  it('schedules localization when an owned plugin is admitted with a README', async () => {
    const { useCase, actor, localized } = harness({
      linkedGitHubId: GITHUB_USER_ID,
      snapshot: snapshot({ readmeMarkdown: '# Hello' }),
    })

    await useCase.execute(actor, {
      kind: 'bundle',
      sourceSpec: 'github:ada/dsh-hello-plugin',
    })

    expect(localized).toEqual(['dsh-hello-plugin'])
  })

  it('queues a repository the submitter cannot prove they own', async () => {
    const { useCase, actor, artifacts } = harness({ linkedGitHubId: '999' })

    const result = await useCase.execute(actor, {
      kind: 'bundle',
      sourceSpec: 'github:ada/dsh-hello-plugin',
    })

    expect(result.status).toBe('pending')
    expect(artifacts).toHaveLength(0)
  })

  it('queues when the account has no GitHub identity at all', async () => {
    const { useCase, actor } = harness({})

    const result = await useCase.execute(actor, {
      kind: 'bundle',
      sourceSpec: 'github:ada/dsh-hello-plugin',
    })

    expect(result.status).toBe('pending')
  })

  it('refuses a device token, which is a CLI rather than a person', async () => {
    const { useCase, actor } = harness({ linkedGitHubId: GITHUB_USER_ID })

    await expect(
      useCase.execute(
        { ...actor, channel: 'device-token' },
        { kind: 'bundle', sourceSpec: 'github:ada/dsh-hello-plugin' },
      ),
    ).rejects.toThrow()
  })
})
