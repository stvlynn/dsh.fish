import { Agent } from 'agents'
import type { HubEnv } from '../config/env.js'
import { openPersistence } from '../persistence/open-persistence.js'
import { ReadmeLocalizationProcessor } from './readme-localization-processor.js'
import type {
  EnqueueReadmeInput,
  TranslateSummaryTask,
  TranslateReadmeChunkTask,
} from './readme-localization-processor.js'
export type { EnqueueReadmeInput } from './readme-localization-processor.js'

/** Cloudflare queue adapter; translation behavior is shared with the Node worker. */
export class ReadmeI18nAgent extends Agent<HubEnv> {
  private processor() {
    return new ReadmeLocalizationProcessor(this.env, {
      open: () => openPersistence(this.env),
      queue: (name, task, options) =>
        this.queue(name as 'translateSummary' | 'translateReadmeChunk', task as never, options),
      retry: (operation, options) => this.retry(operation, options),
    })
  }
  enqueueReadme(input: EnqueueReadmeInput) {
    return this.processor().enqueueReadme(input)
  }
  translateSummary(task: TranslateSummaryTask, item: unknown) {
    return this.processor().translateSummary(task, item)
  }
  translateReadmeChunk(task: TranslateReadmeChunkTask, item: unknown) {
    return this.processor().translateReadmeChunk(task, item)
  }
  async translateLocale(_task: unknown, _item: unknown): Promise<void> {}
}
