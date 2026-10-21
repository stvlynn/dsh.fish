import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadmeI18nAgent } from './readme-i18n-agent.js'
import { openPersistence } from '../persistence/open-persistence.js'
import { translateWithLmStudio } from './lm-studio-readme-translator.js'
import {
  readmeDigest,
  README_TRANSLATION_POLICY_VERSION,
} from '../../application/lib/readme-digest.js'
import type { HubEnv } from '../config/env.js'
import { slug } from '../../domain/shared/slug.js'

vi.mock('agents', () => ({ Agent: class {} }))
vi.mock('../persistence/open-persistence.js', () => ({
  openPersistence: vi.fn(),
}))
vi.mock('./lm-studio-readme-translator.js', () => ({
  translateWithLmStudio: vi.fn(),
}))

function persistence() {
  return {
    dispose: vi.fn(async () => {}),
    artifacts: {
      findById: vi.fn(async () => ({ summary: 'A summary' })),
      refreshSearchMetadata: vi.fn(async () => {}),
      refreshLocalizedSearchDocument: vi.fn(async () => {}),
    },
    readmes: { find: vi.fn(), save: vi.fn(async () => {}) },
    summaries: { find: vi.fn(), save: vi.fn(async () => {}) },
    chunks: {
      prepare: vi.fn(async () => new Set<number>()),
      save: vi.fn(async () => {}),
      assemble: vi.fn(async () => 'Translated README'),
      clear: vi.fn(async () => {}),
    },
  }
}
function usePersistence(value: ReturnType<typeof persistence>) {
  vi.mocked(openPersistence).mockResolvedValue(
    value as unknown as Awaited<ReturnType<typeof openPersistence>>,
  )
}
function agent(env: Partial<HubEnv> = {}) {
  const value = Object.create(ReadmeI18nAgent.prototype) as ReadmeI18nAgent
  Object.assign(value, {
    env,
    queue: vi.fn(async () => {}),
    retry: (operation: () => Promise<string>) => operation(),
  })
  return value
}
const queueItem = {} as never
const baseTask = {
  artifactId: slug('test-plugin'),
  locale: 'ja',
  policyVersion: README_TRANSLATION_POLICY_VERSION,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(translateWithLmStudio).mockResolvedValue('Translated')
})

describe('ReadmeI18nAgent per-invocation persistence', () => {
  it('uses all four selected repositories and disposes enqueue work', async () => {
    const db = persistence()
    usePersistence(db)
    const worker = agent({ STORAGE_BACKEND: 'mysql' })
    await worker.enqueueReadme({
      artifactId: slug('test-plugin'),
      locales: ['ja'],
      summary: 'A summary',
      markdown: '# README',
    })
    expect(openPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ STORAGE_BACKEND: 'mysql' }),
    )
    expect(db.artifacts.refreshSearchMetadata).toHaveBeenCalledOnce()
    expect(db.summaries.save).toHaveBeenCalledOnce()
    expect(db.readmes.save).toHaveBeenCalledOnce()
    expect(db.chunks.prepare).toHaveBeenCalledOnce()
    expect(worker.queue).toHaveBeenCalledWith(
      'translateSummary',
      expect.anything(),
      expect.anything(),
    )
    expect(worker.queue).toHaveBeenCalledWith(
      'translateReadmeChunk',
      expect.anything(),
      expect.anything(),
    )
    expect(db.dispose).toHaveBeenCalledOnce()
  })
  it('reopens persistence instead of retaining sockets between invocations', async () => {
    const first = persistence(),
      second = persistence()
    vi.mocked(openPersistence)
      .mockResolvedValueOnce(first as unknown as Awaited<ReturnType<typeof openPersistence>>)
      .mockResolvedValueOnce(second as unknown as Awaited<ReturnType<typeof openPersistence>>)
    const worker = agent()
    const input = {
      artifactId: slug('test-plugin'),
      locales: ['ja'],
      summary: 'A summary',
    }
    await worker.enqueueReadme(input)
    await worker.enqueueReadme(input)
    expect(openPersistence).toHaveBeenCalledTimes(2)
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.dispose).toHaveBeenCalledOnce()
  })
  it('disposes after enqueue scheduling fails', async () => {
    const db = persistence()
    usePersistence(db)
    const worker = agent()
    vi.mocked(worker.queue).mockRejectedValue(new Error('queue failed'))
    await expect(
      worker.enqueueReadme({
        artifactId: slug('test-plugin'),
        locales: ['ja'],
        summary: 'A summary',
      }),
    ).rejects.toThrow('queue failed')
    expect(db.dispose).toHaveBeenCalledOnce()
  })
  it('holds summary persistence until model work and search refresh settle', async () => {
    const db = persistence()
    usePersistence(db)
    const summaryHash = await readmeDigest('A summary')
    db.summaries.find.mockResolvedValue({
      sourceHash: summaryHash,
      status: 'pending',
    })
    await agent().translateSummary({ ...baseTask, summaryHash }, queueItem)
    expect(db.summaries.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', text: 'Translated' }),
    )
    expect(db.artifacts.refreshLocalizedSearchDocument).toHaveBeenCalledOnce()
    expect(db.dispose).toHaveBeenCalledOnce()
    expect(db.dispose.mock.invocationCallOrder[0]).toBeGreaterThan(
      db.artifacts.refreshLocalizedSearchDocument.mock.invocationCallOrder[0]!,
    )
  })
  it('records model failure, rethrows for retry and still disposes', async () => {
    const db = persistence()
    usePersistence(db)
    const summaryHash = await readmeDigest('A summary')
    db.summaries.find.mockResolvedValue({
      sourceHash: summaryHash,
      status: 'pending',
    })
    vi.mocked(translateWithLmStudio).mockRejectedValue(new Error('model failed'))
    await expect(agent().translateSummary({ ...baseTask, summaryHash }, queueItem)).rejects.toThrow(
      'model failed',
    )
    expect(db.summaries.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'model failed' }),
    )
    expect(db.dispose).toHaveBeenCalledOnce()
  })
  it('assembles README chunks through selected persistence and closes on success', async () => {
    const db = persistence()
    usePersistence(db)
    db.readmes.find.mockResolvedValue({
      sourceHash: 'hash',
      status: 'pending',
    })
    await agent().translateReadmeChunk(
      {
        ...baseTask,
        sourceHash: 'hash',
        chunkIndex: 0,
        chunkCount: 1,
        text: 'README',
        translate: false,
      },
      queueItem,
    )
    expect(db.chunks.save).toHaveBeenCalledOnce()
    expect(db.chunks.clear).toHaveBeenCalledOnce()
    expect(db.readmes.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        markdown: 'Translated README',
      }),
    )
    expect(db.dispose).toHaveBeenCalledOnce()
  })
  it('disposes early-return tasks without invoking the model', async () => {
    const db = persistence()
    usePersistence(db)
    db.readmes.find.mockResolvedValue({
      sourceHash: 'hash',
      status: 'completed',
    })
    await agent().translateReadmeChunk(
      {
        ...baseTask,
        sourceHash: 'hash',
        chunkIndex: 0,
        chunkCount: 1,
        text: 'README',
        translate: true,
      },
      queueItem,
    )
    expect(translateWithLmStudio).not.toHaveBeenCalled()
    expect(db.dispose).toHaveBeenCalledOnce()
  })
  it('rejects paused writes before opening persistence or consuming queued work', async () => {
    const worker = agent({ CATALOG_WRITES_PAUSED: 'true' })
    await expect(
      worker.enqueueReadme({
        artifactId: slug('test-plugin'),
        locales: ['ja'],
        summary: 'summary',
      }),
    ).rejects.toThrow('writes are paused')
    await expect(
      worker.translateSummary({ ...baseTask, summaryHash: 'hash' }, queueItem),
    ).rejects.toThrow('writes are paused')
    await expect(
      worker.translateReadmeChunk(
        {
          ...baseTask,
          sourceHash: 'hash',
          chunkIndex: 0,
          chunkCount: 1,
          text: 'README',
          translate: true,
        },
        queueItem,
      ),
    ).rejects.toThrow('writes are paused')
    expect(openPersistence).not.toHaveBeenCalled()
    expect(worker.queue).not.toHaveBeenCalled()
  })
})
