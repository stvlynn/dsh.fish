import type { Persistence } from './persistence/open-persistence.js'
import type { ArtifactAskPort } from '../application/port/artifact-ask.js'
import { openPersistence } from './persistence/open-persistence.js'
import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'
import { GetArtifactDetail } from '../application/use-case/get-artifact-detail.js'
import { AskArtifact } from '../application/use-case/ask-artifact.js'
import { BackfillReadmeLocalization } from '../application/use-case/backfill-readme-localization.js'
import { GetArtifactReviews } from '../application/use-case/get-artifact-reviews.js'
import { GetCatalogSnapshot } from '../application/use-case/get-catalog-snapshot.js'
import { GetMarketIndex } from '../application/use-case/get-market-index.js'
import { DescribeScoring } from '../application/use-case/describe-scoring.js'
import { IngestCatalog } from '../application/use-case/ingest-catalog.js'
import { ReclassifyCatalog } from '../application/use-case/reclassify-catalog.js'
import { ListCatalogFacets } from '../application/use-case/list-catalog-facets.js'
import { RefreshCatalogFacets } from '../application/use-case/refresh-catalog-facets.js'
import { ListSitemapEntries } from '../application/use-case/list-sitemap-entries.js'
import { RateArtifact } from '../application/use-case/rate-artifact.js'
import { ResolveInstallPlan } from '../application/use-case/resolve-install-plan.js'
import { SearchArtifacts } from '../application/use-case/search-artifacts.js'
import { SubmitArtifact } from '../application/use-case/submit-artifact.js'
import type { IdGenerator, SourceIndexer } from '../application/port/source-indexer.js'
import type { ReadmeLocalizationScheduler } from '../application/port/readme-localization.js'
import type { ArtifactRepository } from '../domain/artifact/artifact-repository.js'
import type { ReviewRepository } from '../domain/review/review.js'
import type { SubmissionRepository } from '../domain/submission/submission.js'
import { readConfig } from './config/env.js'
import type { HubConfig, HubEnv } from './config/env.js'
import { createAuth } from './auth/auth.js'
import type { HubAuth } from './auth/auth.js'
import { GitHubIndexer } from './ingestion/github-indexer.js'
import { GitHubSocialPreview } from './ingestion/github-social-preview.js'
import { NpmIndexer } from './ingestion/npm-indexer.js'
import { AwesomeListIndexer } from './ingestion/awesome-list-indexer.js'
import { HttpCuratedCategoryOverlay } from './ingestion/http-curated-category-overlay.js'
import { KvOffsetCursor, reclassifyCursorKey } from './ingestion/offset-cursor.js'
import { KvListCursor, listCursorKey } from './ingestion/list-cursor.js'
import { RepoProber } from './ingestion/repo-prober.js'
import { KvSweepCursor, sweepCursorKey } from './ingestion/sweep-cursor.js'
import { KvHomeRailCache } from './persistence/kv-home-rail-cache.js'
import { KvCatalogSnapshotStore } from './persistence/kv-catalog-snapshot-store.js'
import { KvReadmeLocalizationBackfillProgress } from './agents/kv-readme-localization-backfill-progress.js'
import { AdaClient } from './ada/ada-client.js'
import { KvAskRateLimiter } from './ask/kv-ask-rate-limiter.js'

export interface Container {
  readonly dispose: () => Promise<void>
  readonly config: HubConfig
  readonly auth: HubAuth
  readonly artifacts: ArtifactRepository
  readonly submissions: SubmissionRepository
  readonly reviews: ReviewRepository
  readonly useCases: {
    readonly searchArtifacts: SearchArtifacts
    readonly getArtifactDetail: GetArtifactDetail
    readonly getArtifactReviews: GetArtifactReviews
    readonly getCatalogSnapshot: GetCatalogSnapshot
    readonly getMarketIndex: GetMarketIndex
    readonly describeScoring: DescribeScoring
    readonly listCatalogFacets: ListCatalogFacets
    readonly refreshCatalogFacets: RefreshCatalogFacets
    readonly listSitemapEntries: ListSitemapEntries
    readonly rateArtifact: RateArtifact
    readonly resolveInstallPlan: ResolveInstallPlan
    readonly submitArtifact: SubmitArtifact
    readonly ingestCatalog: IngestCatalog
    readonly reclassifyCatalog: ReclassifyCatalog
    readonly backfillReadmeLocalization: BackfillReadmeLocalization
    readonly askArtifact: AskArtifact
  }
}

const ids: IdGenerator = { next: () => crypto.randomUUID() }

export interface ContainerOptions {
  readonly persistence?: Persistence
  readonly ada?: ArtifactAskPort
  readonly cf?: IncomingRequestCfProperties
  readonly readmeLocalization: ReadmeLocalizationScheduler
  readonly supportedLocales?: readonly string[]
}

/**
 * Composition root.
 *
 * A Worker isolate handles many requests, but D1 and KV bindings arrive per
 * request, so the container is built per request rather than cached at module
 * scope. MySQL uses an invocation-local lazy pool; construction performs no
 * database warm-up query.
 */
export async function createContainer(env: HubEnv, options: ContainerOptions): Promise<Container> {
  const config = readConfig(env)
  const supportedLocales = options.supportedLocales ?? ['en']
  const persistence = options.persistence ?? (await openPersistence(env, supportedLocales))
  try {
    const {
      artifacts,
      readmes: readmeTranslations,
      summaries: summaryTranslations,
      backfill: readmeBackfillSource,
      submissions,
      reviews,
      identities,
    } = persistence
    const socialPreview = new GitHubSocialPreview(config.githubToken)
    const indexers: readonly SourceIndexer[] = [
      new GitHubIndexer(
        config.githubToken,
        new KvSweepCursor(env.KV, sweepCursorKey('github')),
        socialPreview,
      ),
      new NpmIndexer(socialPreview),
      new AwesomeListIndexer(
        new RepoProber(config.githubToken, socialPreview),
        new KvListCursor(env.KV, listCursorKey('awesome-list')),
      ),
    ]

    return {
      config,
      dispose: persistence.dispose,
      auth: createAuth(env, options.cf, config.baseUrl, persistence.mysqlDb),
      artifacts,
      submissions,
      reviews,
      useCases: {
        searchArtifacts: new SearchArtifacts(
          artifacts,
          summaryTranslations,
          new KvHomeRailCache(env.KV, env.STORAGE_BACKEND === 'mysql' ? 'mysql-v1:' : ''),
        ),
        getArtifactDetail: new GetArtifactDetail(
          artifacts,
          readmeTranslations,
          summaryTranslations,
          config.artifactAskEnabled,
        ),
        getArtifactReviews: new GetArtifactReviews(reviews, artifacts),
        getCatalogSnapshot: new GetCatalogSnapshot(
          artifacts,
          new KvCatalogSnapshotStore(env.KV, env.STORAGE_BACKEND === 'mysql' ? 'mysql-v1:' : ''),
        ),
        getMarketIndex: new GetMarketIndex(artifacts),
        describeScoring: new DescribeScoring(),
        listCatalogFacets: new ListCatalogFacets(artifacts),
        refreshCatalogFacets: new RefreshCatalogFacets(artifacts),
        listSitemapEntries: new ListSitemapEntries(
          artifacts,
          supportedLocales,
          config.seoLocaleGating,
        ),
        rateArtifact: new RateArtifact(reviews, artifacts),
        resolveInstallPlan: new ResolveInstallPlan(artifacts),
        submitArtifact: new SubmitArtifact(
          submissions,
          artifacts,
          indexers,
          ids,
          identities,
          options.readmeLocalization,
        ),
        ingestCatalog: new IngestCatalog(artifacts, indexers, options.readmeLocalization),
        reclassifyCatalog: new ReclassifyCatalog(
          artifacts,
          new HttpCuratedCategoryOverlay(),
          new KvOffsetCursor(env.KV, reclassifyCursorKey()),
        ),
        backfillReadmeLocalization: new BackfillReadmeLocalization(
          readmeBackfillSource,
          new KvReadmeLocalizationBackfillProgress(env.KV),
          options.readmeLocalization,
        ),
        askArtifact: new AskArtifact(
          artifacts,
          options.ada ?? new AdaClient(),
          new KvAskRateLimiter(env.KV, {
            ...(config.artifactAskMaxPerIp === undefined
              ? {}
              : { maxPerIp: config.artifactAskMaxPerIp }),
          }),
          config.artifactAskEnabled,
        ),
      },
    }
  } catch (error) {
    await persistence.dispose()
    throw error
  }
}
