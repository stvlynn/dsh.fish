import { describe, expect, it } from 'vitest'
import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import type {
  ReadmeTranslation,
  ReadmeTranslationRepository,
} from '../../domain/artifact/readme-translation.js'
import { npmSource } from '../../domain/artifact/source-ref.js'
import type {
  SummaryTranslation,
  SummaryTranslationRepository,
} from '../../domain/artifact/summary-translation.js'
import type { Slug } from '../../domain/shared/slug.js'
import { readmeDigest } from '../lib/readme-digest.js'
import { GetArtifactDetail } from './get-artifact-detail.js'

const artifact = Artifact.create({
  id: 'dsh-hello',
  kind: 'bundle',
  displayName: 'dsh-hello',
  summary: 'A bundle.',
  source: npmSource('dsh-hello', '1.0.0'),
  payload: { kind: 'bundle', requiresBuild: false },
  readmeMarkdown: '# Hello',
})

function artifactRepository(): ArtifactRepository {
  return {
    findById: async (id) => (id === artifact.id ? artifact : undefined),
    search: async () => {
      throw new Error('not used')
    },
    readFacetCounts: async () => undefined,
    refreshFacetCounts: async () => {},
    save: async () => {},
    saveMany: async () => {},
    incrementInstalls: async () => {},
    recordMetricsSnapshot: async () => {},
    listIdsByOrigin: async () => [],
    listForSitemap: async () => {
      throw new Error('not used')
    },
    listForSnapshot: async () => [],
    catalogStats: async () => ({
      artifactCount: 1,
      maxUpdatedAtMs: 0,
      installs: 0,
      stars: 0,
      downloads: 0,
    }),
  }
}

function translations(value?: ReadmeTranslation): ReadmeTranslationRepository {
  return {
    find: async (_artifactId: Slug, _locale: string) => value,
    save: async () => {},
  }
}

function summaryTranslations(value?: SummaryTranslation): SummaryTranslationRepository {
  return {
    find: async (_artifactId: Slug, _locale: string) => value,
    listFor: async () => (value === undefined ? [] : [value]),
    save: async () => {},
  }
}

describe('GetArtifactDetail README localization', () => {
  it('returns the completed translation for the requested locale', async () => {
    const sourceHash = await readmeDigest(artifact.readmeMarkdown!)
    const useCase = new GetArtifactDetail(
      artifactRepository(),
      translations({
        artifactId: artifact.id,
        locale: 'zh-CN',
        sourceHash,
        status: 'completed',
        markdown: '# 你好',
        updatedAt: new Date(),
      }),
      summaryTranslations(),
    )

    const detail = await useCase.execute(artifact.id, 'zh-CN')

    expect(detail).toMatchObject({
      readmeMarkdown: '# 你好',
      readmeLocale: 'zh-CN',
      readmeMachineTranslated: true,
    })
  })

  it('keeps the previous completed README until its replacement lands', async () => {
    const useCase = new GetArtifactDetail(
      artifactRepository(),
      translations({
        artifactId: artifact.id,
        locale: 'zh-CN',
        sourceHash: 'stale',
        status: 'completed',
        markdown: '# 旧译文',
        updatedAt: new Date(),
      }),
      summaryTranslations(),
    )

    const detail = await useCase.execute(artifact.id, 'zh-CN')

    expect(detail).toMatchObject({
      readmeMarkdown: '# 旧译文',
      readmeLocale: 'zh-CN',
      readmeMachineTranslated: true,
    })
  })

  it('keeps the previous README while a replacement is pending', async () => {
    const useCase = new GetArtifactDetail(
      artifactRepository(),
      translations({
        artifactId: artifact.id,
        locale: 'zh-CN',
        sourceHash: 'new-policy',
        status: 'pending',
        markdown: '# 旧译文',
        updatedAt: new Date(),
      }),
      summaryTranslations(),
    )

    const detail = await useCase.execute(artifact.id, 'zh-CN')

    expect(detail.readmeMarkdown).toBe('# 旧译文')
    expect(detail.readmeMachineTranslated).toBe(true)
  })

  it('serves the translated summary when it is current', async () => {
    const useCase = new GetArtifactDetail(
      artifactRepository(),
      translations(),
      summaryTranslations({
        artifactId: artifact.id,
        locale: 'zh-CN',
        sourceHash: await readmeDigest(artifact.summary),
        status: 'completed',
        text: '一个 bundle。',
        updatedAt: new Date(),
      }),
    )

    const detail = await useCase.execute(artifact.id, 'zh-CN')

    expect(detail.summary).toBe('一个 bundle。')
  })

  it('keeps the previous summary until a current completed replacement lands', async () => {
    const stale = new GetArtifactDetail(
      artifactRepository(),
      translations(),
      summaryTranslations({
        artifactId: artifact.id,
        locale: 'zh-CN',
        sourceHash: 'stale',
        status: 'completed',
        text: '过时的。',
        updatedAt: new Date(),
      }),
    )
    expect((await stale.execute(artifact.id, 'zh-CN')).summary).toBe('过时的。')

    const failedWithoutBody = new GetArtifactDetail(
      artifactRepository(),
      translations(),
      summaryTranslations({
        artifactId: artifact.id,
        locale: 'zh-CN',
        sourceHash: await readmeDigest(artifact.summary),
        status: 'failed',
        error: 'rate limited',
        updatedAt: new Date(),
      }),
    )
    expect((await failedWithoutBody.execute(artifact.id, 'zh-CN')).summary).toBe('A bundle.')
  })

  it('localizes the summary even when the artifact has no README', async () => {
    const noReadme = Artifact.create({
      id: 'dsh-bare',
      kind: 'bundle',
      displayName: 'dsh-bare',
      summary: 'No docs.',
      source: npmSource('dsh-bare', '1.0.0'),
      payload: { kind: 'bundle', requiresBuild: false },
    })
    const repo = artifactRepository()
    const useCase = new GetArtifactDetail(
      { ...repo, findById: async () => noReadme },
      translations(),
      summaryTranslations({
        artifactId: noReadme.id,
        locale: 'ja',
        sourceHash: await readmeDigest(noReadme.summary),
        status: 'completed',
        text: 'ドキュメントなし。',
        updatedAt: new Date(),
      }),
    )

    const detail = await useCase.execute(noReadme.id, 'ja')

    expect(detail.summary).toBe('ドキュメントなし。')
    expect(detail.readmeMarkdown).toBeUndefined()
  })
})
