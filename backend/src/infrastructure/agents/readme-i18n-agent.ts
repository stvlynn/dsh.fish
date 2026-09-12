import { Agent } from 'agents'
import type { QueueItem } from 'agents'
import { drizzle } from 'drizzle-orm/d1'
import {
  README_TRANSLATION_POLICY_VERSION,
  readmeDigest,
} from '../../application/lib/readme-digest.js'
import type { ScheduleReadmeLocalizationInput } from '../../application/port/readme-localization.js'
import type { ReadmeTranslation } from '../../domain/artifact/readme-translation.js'
import type { SummaryTranslation } from '../../domain/artifact/summary-translation.js'
import { slug } from '../../domain/shared/slug.js'
import type { HubEnv } from '../config/env.js'
import { D1ArtifactRepository } from '../persistence/d1-artifact-repository.js'
import { D1ReadmeTranslationChunkRepository } from '../persistence/d1-readme-translation-chunk-repository.js'
import { D1ReadmeTranslationRepository } from '../persistence/d1-readme-translation-repository.js'
import { D1SummaryTranslationRepository } from '../persistence/d1-summary-translation-repository.js'
import * as schema from '../persistence/schema.js'
import { translateWithLmStudio } from './lm-studio-readme-translator.js'
import {
  preserveBoundaryNewlines,
  splitReadmeForTranslation,
} from './readme-translation-chunks.js'

export interface EnqueueReadmeInput extends ScheduleReadmeLocalizationInput {
  readonly locales: readonly string[]
}

interface TranslateSummaryTask {
  readonly artifactId: string
  readonly locale: string
  readonly summaryHash: string
  readonly policyVersion?: string
}

interface TranslateReadmeChunkTask {
  readonly artifactId: string
  readonly locale: string
  readonly sourceHash: string
  readonly chunkIndex: number
  readonly chunkCount: number
  readonly text: string
  readonly translate: boolean
  readonly policyVersion?: string
}

/** Payload retained so pre-deployment queue entries can drain as safe no-ops. */
interface LegacyTranslateLocaleTask {
  readonly artifactId: string
  readonly locale: string
  readonly sourceHash?: string
  readonly summaryHash: string
}

const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
const QUEUE_RETRY = { maxAttempts: 5, baseDelayMs: 2_000, maxDelayMs: 30_000 } as const

/**
 * Durable localization worker. The scheduler maps the catalog onto a fixed
 * number of these FIFO queues, bounding aggregate LM Studio concurrency.
 * README chunks make progress independently and are assembled from D1 once
 * every chunk for the current source hash is present.
 */
export class ReadmeI18nAgent extends Agent<HubEnv> {
  async enqueueReadme(input: EnqueueReadmeInput): Promise<void> {
    const artifactId = slug(input.artifactId)
    const locales = [...new Set(input.locales)]
    if (locales.length === 0 || locales.some((locale) => !LOCALE.test(locale))) {
      throw new Error('README localization needs valid target locales.')
    }

    const markdown = input.markdown?.trim() === '' ? undefined : input.markdown
    const sourceHash = markdown === undefined ? undefined : await readmeDigest(markdown)
    const summaryHash = await readmeDigest(input.summary)
    const chunks = markdown === undefined ? [] : splitReadmeForTranslation(markdown)

    await this.artifactRepository().refreshSearchMetadata(artifactId)
    const readmes = this.translationRepository()
    const summaries = this.summaryRepository()
    const pendingReadmes: Array<{
      readonly locale: string
      readonly completed: ReadonlySet<number>
    }> = []

    // Short summaries are queued before long READMEs so translated catalog
    // listings become useful early in a multi-day backfill.
    for (const locale of locales) {
      const summary = await summaries.find(artifactId, locale)
      const summarySourceChanged = summary?.sourceHash !== summaryHash
      const summaryStale = summarySourceChanged || summary?.status === 'failed'
      if (summaryStale) {
        const task: TranslateSummaryTask = {
          artifactId,
          locale,
          summaryHash,
          policyVersion: README_TRANSLATION_POLICY_VERSION,
        }
        await summaries.save(summaryRecord(task, 'pending'), {
          retainPreviousBody: !summarySourceChanged,
        })
        await this.queue('translateSummary', task, {
          retry: QUEUE_RETRY,
        })
      }

      let readmeStale = false
      if (sourceHash !== undefined) {
        const readme = await readmes.find(artifactId, locale)
        const readmeSourceChanged = readme?.sourceHash !== sourceHash
        readmeStale = readmeSourceChanged || readme?.status === 'failed'
        if (readmeStale) {
          await readmes.save(readmeRecord({ artifactId, locale, sourceHash }, 'pending'), {
            retainPreviousBody: !readmeSourceChanged,
          })
          const completed = await this.chunkRepository().prepare(artifactId, locale, sourceHash)
          pendingReadmes.push({ locale, completed })
        }
      }

      if (!summaryStale && !readmeStale) {
        await this.artifactRepository().refreshLocalizedSearchDocument(artifactId, locale)
      }
    }

    for (const { locale, completed } of pendingReadmes) {
      for (const chunk of chunks) {
        if (completed.has(chunk.index)) continue
        const task: TranslateReadmeChunkTask = {
          artifactId,
          locale,
          sourceHash: sourceHash!,
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          text: chunk.text,
          translate: chunk.translate,
          policyVersion: README_TRANSLATION_POLICY_VERSION,
        }
        await this.queue('translateReadmeChunk', task, {
          retry: QUEUE_RETRY,
        })
      }
    }
  }

  async translateSummary(
    task: TranslateSummaryTask,
    _queueItem: QueueItem<TranslateSummaryTask>,
  ): Promise<void> {
    if (task.policyVersion !== README_TRANSLATION_POLICY_VERSION) return
    const artifactId = slug(task.artifactId)
    const artifact = await this.artifactRepository().findById(artifactId)
    const summary = artifact?.summary
    if (
      summary === undefined ||
      summary === '' ||
      (await readmeDigest(summary)) !== task.summaryHash
    ) {
      return
    }
    const existing = await this.summaryRepository().find(artifactId, task.locale)
    if (existing?.sourceHash !== task.summaryHash || existing.status === 'completed') return

    try {
      const translated = await this.retry(
        () => translateWithLmStudio(this.env.I18N_MODEL, summary, task.locale, 'summary'),
        { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000 },
      )
      await this.summaryRepository().save(summaryRecord(task, 'completed', { text: translated }))
      await this.artifactRepository().refreshLocalizedSearchDocument(artifactId, task.locale)
    } catch (error) {
      await this.summaryRepository().save(summaryRecord(task, 'failed', { error: describe(error) }))
      throw error
    }
  }

  async translateReadmeChunk(
    task: TranslateReadmeChunkTask,
    _queueItem: QueueItem<TranslateReadmeChunkTask>,
  ): Promise<void> {
    if (task.policyVersion !== README_TRANSLATION_POLICY_VERSION) return
    const artifactId = slug(task.artifactId)
    const existing = await this.translationRepository().find(artifactId, task.locale)
    if (existing?.sourceHash !== task.sourceHash || existing.status === 'completed') return

    try {
      const translated = task.translate
        ? await this.retry(
            async () =>
              preserveBoundaryNewlines(
                task.text,
                await translateWithLmStudio(
                  this.env.I18N_MODEL,
                  task.text,
                  task.locale,
                  'readme',
                ),
              ),
            { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 8_000 },
          )
        : task.text
      const chunks = this.chunkRepository()
      await chunks.save({ ...task, artifactId, text: translated })
      const markdown = await chunks.assemble(
        artifactId,
        task.locale,
        task.sourceHash,
        task.chunkCount,
      )
      if (markdown === undefined) return

      await this.translationRepository().save(readmeRecord(task, 'completed', { markdown }))
      await chunks.clear(artifactId, task.locale, task.sourceHash)
      await this.artifactRepository().refreshLocalizedSearchDocument(artifactId, task.locale)
    } catch (error) {
      await this.translationRepository().save(
        readmeRecord(task, 'failed', { error: describe(error) }),
      )
      throw error
    }
  }

  /** Old per-locale tasks drain safely after the deployment. */
  async translateLocale(
    _task: LegacyTranslateLocaleTask,
    _queueItem: QueueItem<LegacyTranslateLocaleTask>,
  ): Promise<void> {}

  private artifactRepository(): D1ArtifactRepository {
    return new D1ArtifactRepository(drizzle(this.env.DB, { schema }))
  }

  private translationRepository(): D1ReadmeTranslationRepository {
    return new D1ReadmeTranslationRepository(drizzle(this.env.DB, { schema }))
  }

  private summaryRepository(): D1SummaryTranslationRepository {
    return new D1SummaryTranslationRepository(drizzle(this.env.DB, { schema }))
  }

  private chunkRepository(): D1ReadmeTranslationChunkRepository {
    return new D1ReadmeTranslationChunkRepository(drizzle(this.env.DB, { schema }))
  }
}

function readmeRecord(
  task: {
    readonly artifactId: string
    readonly locale: string
    readonly sourceHash: string
  },
  status: ReadmeTranslation['status'],
  result: { readonly markdown?: string; readonly error?: string } = {},
): ReadmeTranslation {
  return {
    artifactId: slug(task.artifactId),
    locale: task.locale,
    sourceHash: task.sourceHash,
    status,
    ...(result.markdown === undefined ? {} : { markdown: result.markdown }),
    ...(result.error === undefined ? {} : { error: result.error.slice(0, 1_000) }),
    updatedAt: new Date(),
  }
}

function summaryRecord(
  task: TranslateSummaryTask,
  status: SummaryTranslation['status'],
  result: { readonly text?: string; readonly error?: string } = {},
): SummaryTranslation {
  return {
    artifactId: slug(task.artifactId),
    locale: task.locale,
    sourceHash: task.summaryHash,
    status,
    ...(result.text === undefined ? {} : { text: result.text }),
    ...(result.error === undefined ? {} : { error: result.error.slice(0, 1_000) }),
    updatedAt: new Date(),
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
