import { createHash } from 'node:crypto'
import { Queue, Worker } from 'bullmq'
import type { ConnectionOptions, Job } from 'bullmq'
import type { HubEnv } from '../config/env.js'
import type { Persistence } from '../persistence/open-persistence.js'
import type {
  ReadmeLocalizationScheduler,
  ScheduleReadmeLocalizationInput,
} from '../../application/port/readme-localization.js'
import { ReadmeLocalizationProcessor } from '../agents/readme-localization-processor.js'
import type {
  EnqueueReadmeInput,
  TranslateReadmeChunkTask,
  TranslateSummaryTask,
} from '../agents/readme-localization-processor.js'
import { createContainer } from '../container.js'

import { translateWithChatModel } from '../agents/lm-studio-readme-translator.js'

const LOCALIZATION_QUEUE = 'hub-localization-v1'
const MAINTENANCE_QUEUE = 'hub-maintenance-v1'

/** Persistent, idempotent jobs; model concurrency is bounded independently of HTTP. */
export class NodeJobs implements ReadmeLocalizationScheduler {
  private readonly localization: Queue
  private readonly maintenance: Queue
  private readonly workers: Worker[] = []

  constructor(
    private readonly connection: ConnectionOptions,
    private readonly env: HubEnv,
    private readonly persistence: Persistence,
    private readonly locales: readonly string[],
  ) {
    const defaults = {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 7 * 86_400, count: 1_000 },
    }
    this.localization = new Queue(LOCALIZATION_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    })
    this.maintenance = new Queue(MAINTENANCE_QUEUE, {
      connection,
      defaultJobOptions: defaults,
    })
    for (const queue of [this.localization, this.maintenance]) {
      queue.on('error', (error) => logJobError('queue_error', error))
    }
  }

  async schedule(input: ScheduleReadmeLocalizationInput): Promise<void> {
    await this.enqueue('enqueueReadme', {
      ...input,
      locales: this.locales,
      resumePending: true,
    })
  }

  private async enqueue(name: string, data: unknown): Promise<void> {
    const jobId = createHash('sha256').update(name).update(JSON.stringify(data)).digest('hex')
    await this.localization.add(name, data, { deduplication: { id: jobId } })
  }

  async start(translationEnabled: boolean): Promise<void> {
    await this.localization.waitUntilReady()
    await this.maintenance.waitUntilReady()
    await this.maintenance.upsertJobScheduler(
      'hourly-ingestion',
      { pattern: '0 * * * *' },
      { name: 'ingest', data: {} },
    )
    await this.maintenance.upsertJobScheduler(
      'minutely-backfill',
      { pattern: '* * * * *' },
      { name: 'backfill', data: {} },
    )

    this.workers.push(
      new Worker(MAINTENANCE_QUEUE, (job) => this.runMaintenance(job), {
        connection: {
          ...this.connection,
          maxRetriesPerRequest: null,
          enableOfflineQueue: true,
        },
        concurrency: 1,
      }),
    )
    if (translationEnabled) {
      this.workers.push(
        new Worker(LOCALIZATION_QUEUE, (job) => this.runLocalization(job), {
          connection: {
            ...this.connection,
            maxRetriesPerRequest: null,
            enableOfflineQueue: true,
          },
          concurrency: 1,
        }),
      )
    }
    for (const worker of this.workers) {
      worker.on('error', (error) => logJobError('worker_error', error))
      worker.on('failed', (job, error) => logJobError('job_failed', error, job?.name))
      await worker.waitUntilReady()
    }
  }

  private async runLocalization(job: Job): Promise<void> {
    const processor = new ReadmeLocalizationProcessor(this.env, {
      open: async () => this.persistence,
      translate: (service, text, locale, kind) =>
        translateWithChatModel(service, text, locale, kind, {
          url: 'https://opencode.ai/inference/openai/v1/chat/completions',
          model: 'mimo-v2.6-flash-free',
          provider: 'opencode',
          apiKey: this.env.OPENCODE_GO_API_KEY,
        }),
      queue: async (name, task) => this.enqueue(name, task),
      // BullMQ owns durable retries; an attempt runs the model once.
      retry: (operation) => operation(),
    })
    if (job.name === 'enqueueReadme') await processor.enqueueReadme(job.data as EnqueueReadmeInput)
    else if (job.name === 'translateSummary')
      await processor.translateSummary(job.data as TranslateSummaryTask, undefined)
    else if (job.name === 'translateReadmeChunk')
      await processor.translateReadmeChunk(job.data as TranslateReadmeChunkTask, undefined)
    else throw new Error('Unknown localization job type.')
  }

  private async runMaintenance(job: Job): Promise<void> {
    if (this.env.CATALOG_CRON_PAUSED !== 'false' || this.env.CATALOG_WRITES_PAUSED === 'true')
      return
    const container = await createContainer(this.env, {
      persistence: this.persistence,
      readmeLocalization: this,
      supportedLocales: this.locales,
    })
    try {
      if (job.name === 'ingest') {
        await container.useCases.ingestCatalog.execute({
          limitPerSource: 25,
          limitByOrigin: { github: 25, 'awesome-list': 10 },
        })
        await container.useCases.reclassifyCatalog.execute({ limit: 100 })
        await container.useCases.refreshCatalogFacets.execute()
      } else if (job.name !== 'backfill') throw new Error('Unknown maintenance job type.')
      await container.useCases.backfillReadmeLocalization.execute(1, {
        retryStaleFailures: job.name === 'ingest',
      })
      console.info(JSON.stringify({ event: 'maintenance_completed', name: job.name }))
    } finally {
      await container.dispose()
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()))
    await Promise.all([this.localization.close(), this.maintenance.close()])
  }
}

function logJobError(event: string, error: Error, job?: string) {
  // Messages may contain source text or credentials from upstream libraries.
  console.error(JSON.stringify({ event, name: error.name, job }))
}
