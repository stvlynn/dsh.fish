import type { KeyValueStore } from '../../application/port/key-value-store.js'
import { README_TRANSLATION_POLICY_VERSION } from '../../application/lib/readme-digest.js'
import type {
  ReadmeLocalizationBackfillProgress,
  ReadmeLocalizationBackfillState,
} from '../../application/port/readme-localization.js'
import { slug } from '../../domain/shared/slug.js'

const COMPLETE = 'complete'
const CURSOR_PREFIX = 'cursor:'
/** Bump when the pass has new derived projections even if translation policy is unchanged. */
const BACKFILL_PROJECTION_VERSION = 'search-v1'
const KEY = `readme-i18n:backfill:${README_TRANSLATION_POLICY_VERSION}:${BACKFILL_PROJECTION_VERSION}`

/** One versioned cursor in KV; a policy version bump automatically starts a new pass. */
export class KvReadmeLocalizationBackfillProgress implements ReadmeLocalizationBackfillProgress {
  constructor(private readonly kv: KeyValueStore) {}

  async load(): Promise<ReadmeLocalizationBackfillState> {
    const value = await this.kv.get(KEY)
    if (value === null) return { complete: false }
    if (value === COMPLETE) return { complete: true }
    if (!value.startsWith(CURSOR_PREFIX)) {
      throw new Error('README backfill cursor has an unknown format.')
    }
    return { afterArtifactId: slug(value.slice(CURSOR_PREFIX.length)), complete: false }
  }

  async save(state: ReadmeLocalizationBackfillState): Promise<void> {
    if (state.complete) {
      await this.kv.put(KEY, COMPLETE)
      return
    }
    if (state.afterArtifactId === undefined) {
      throw new Error('An incomplete README backfill needs a cursor.')
    }
    await this.kv.put(KEY, `${CURSOR_PREFIX}${state.afterArtifactId}`)
  }
}
