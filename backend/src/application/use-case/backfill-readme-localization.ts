import type {
  ReadmeLocalizationBackfillProgress,
  ReadmeLocalizationBackfillSource,
  ReadmeLocalizationBackfillState,
  ReadmeLocalizationScheduler,
} from '../port/readme-localization.js'

const DEFAULT_BATCH_SIZE = 10

/**
 * A terminal failure or abandoned pending task is retried only after a cooling
 * interval. Every attempt stamps `updatedAt`, so an unavailable dependency
 * costs at most one retry batch per interval.
 */
const FAILED_RETRY_DELAY_MS = 6 * 60 * 60 * 1_000

export interface BackfillReadmeLocalizationReport {
  readonly scheduledArtifacts: number
  readonly retriedArtifacts: number
  readonly complete: boolean
  readonly afterArtifactId?: string
}

export interface BackfillReadmeLocalizationOptions {
  /**
   * Whether to also rescan for stale terminal failures. The scan exists to
   * requeue failures after the service cooling interval; it scans the
   * translation indexes and missing-locale projection, so a caller that fires
   * every minute should leave it off and let a slower cadence pay for it.
   * Defaults to `true` so the use case stays self-contained.
   */
  readonly retryStaleFailures?: boolean
}

/**
 * Incrementally schedules every stored README for the current translation
 * policy. A small batch limits enqueue work while the minutely trigger
 * makes a newly deployed policy begin within the next Cron invocation.
 *
 * Cursor persistence happens only after the complete batch is accepted. If an
 * RPC or KV write fails, the next invocation safely repeats the page because
 * each per-artifact Agent deduplicates locale + policy hash.
 *
 * The forward-only cursor never revisits an artifact, so a run can also
 * reschedule a bounded batch of stale terminal failures. The per-artifact
 * Agent re-queues only locales whose stored row is still `failed`; `pending`
 * and `completed` rows with a matching hash are skipped there. Running the
 * retry query every minute forever — long after the backfill completed — is
 * unnecessary; callers on a fast cadence disable it via
 * `options.retryStaleFailures`.
 */
export class BackfillReadmeLocalization {
  constructor(
    private readonly source: ReadmeLocalizationBackfillSource,
    private readonly progress: ReadmeLocalizationBackfillProgress,
    private readonly scheduler: ReadmeLocalizationScheduler,
  ) {}

  async execute(
    limit = DEFAULT_BATCH_SIZE,
    options: BackfillReadmeLocalizationOptions = {},
  ): Promise<BackfillReadmeLocalizationReport> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('README localization backfill limit must be between 1 and 100.')
    }

    let state = await this.progress.load()
    let scheduled = 0
    if (!state.complete) {
      const items = await this.source.listAfter(state.afterArtifactId, limit)
      for (const item of items) {
        await this.scheduler.schedule(item)
      }
      scheduled = items.length

      const last = items.at(-1)
      const afterArtifactId = last?.artifactId ?? state.afterArtifactId
      const next: ReadmeLocalizationBackfillState = {
        ...(afterArtifactId === undefined ? {} : { afterArtifactId }),
        complete: items.length < limit,
      }
      // KV bills per write; an invocation that moved nothing must not pay for
      // rewriting the same cursor.
      if (next.complete !== state.complete || next.afterArtifactId !== state.afterArtifactId) {
        state = next
        await this.progress.save(state)
      }
    }

    const retriedArtifacts =
      options.retryStaleFailures === false ? 0 : await this.retryStaleFailures(limit)
    return report(scheduled, retriedArtifacts, state)
  }

  private async retryStaleFailures(limit: number): Promise<number> {
    const staleBefore = new Date(Date.now() - FAILED_RETRY_DELAY_MS)
    const items = await this.source.listStaleFailures(staleBefore, limit)
    for (const item of items) {
      await this.scheduler.schedule(item)
    }
    return items.length
  }
}

function report(
  scheduledArtifacts: number,
  retriedArtifacts: number,
  state: ReadmeLocalizationBackfillState,
): BackfillReadmeLocalizationReport {
  return {
    scheduledArtifacts,
    retriedArtifacts,
    complete: state.complete,
    ...(state.afterArtifactId === undefined
      ? {}
      : { afterArtifactId: String(state.afterArtifactId) }),
  }
}
