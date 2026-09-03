import { drizzle } from 'drizzle-orm/d1'
import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'
import { GetArtifactDetail } from '../application/use-case/get-artifact-detail.js'
import { AskArtifact } from '../application/use-case/ask-artifact.js'
import { BackfillReadmeLocalization } from '../application/use-case/backfill-readme-localization.js'
import { GetArtifactReviews } from '../application/use-case/get-artifact-reviews.js'
import { GetCatalogSnapshot } from '../application/use-case/get-catalog-snapshot.js'
import { DescribeScoring } from '../application/use-case/describe-scoring.js'
import { IngestCatalog } from '../application/use-case/ingest-catalog.js'
import { ReclassifyCatalog } from '../application/use-case/reclassify-catalog.js'
import { ListCatalogFacets } from '../application/use-case/list-catalog-facets.js'
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
import { D1ArtifactRepository } from './persistence/d1-artifact-repository.js'
import { D1ReadmeTranslationRepository } from './persistence/d1-readme-translation-repository.js'
import { D1SummaryTranslationRepository } from './persistence/d1-summary-translation-repository.js'
import { D1ReadmeLocalizationBackfillSource } from './persistence/d1-readme-localization-backfill-source.js'
import { D1LinkedIdentityReader } from './persistence/d1-linked-identity.js'
import { D1ReviewRepository } from './persistence/d1-review-repository.js'
import { D1SubmissionRepository } from './persistence/d1-submission-repository.js'
import { KvCatalogSnapshotStore } from './persistence/kv-catalog-snapshot-store.js'
import { KvCatalogFacetCache } from './persistence/kv-catalog-facet-cache.js'
import { KvReadmeLocalizationBackfillProgress } from './agents/kv-readme-localization-backfill-progress.js'
import { AdaClient } from './ada/ada-client.js'
import { KvAskRateLimiter } from './ask/kv-ask-rate-limiter.js'
import * as schema from './persistence/schema.js'

export interface Container {
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
    readonly describeScoring: DescribeScoring
    readonly listCatalogFacets: ListCatalogFacets
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
  readonly cf?: IncomingRequestCfProperties
  readonly readmeLocalization: ReadmeLocalizationScheduler
  readonly supportedLocales?: readonly string[]
}

/**
 * Composition root.
 *
 * A Worker isolate handles many requests, but D1 and KV bindings arrive per
 * request, so the container is built per request rather than cached at module
 * scope. Everything it builds is cheap: no connection pools, no warm-up.
 */
export function createContainer(env: HubEnv, options: ContainerOptions): Container {
  const config = readConfig(env)
  const db = drizzle(env.DB, { schema })

  const artifacts = new D1ArtifactRepository(db, config.catalogFtsSearch)
  const readmeTranslations = new D1ReadmeTranslationRepository(db)
  const summaryTranslations = new D1SummaryTranslationRepository(db)
  const readmeBackfillSource = new D1ReadmeLocalizationBackfillSource(db)
  const submissions = new D1SubmissionRepository(db)
  const reviews = new D1ReviewRepository(db)
  const identities = new D1LinkedIdentityReader(db)
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
    auth: createAuth(env, options.cf, config.baseUrl),
    artifacts,
    submissions,
    reviews,
    useCases: {
      searchArtifacts: new SearchArtifacts(artifacts, summaryTranslations),
      getArtifactDetail: new GetArtifactDetail(
        artifacts,
        readmeTranslations,
        summaryTranslations,
        config.artifactAskEnabled,
      ),
      getArtifactReviews: new GetArtifactReviews(reviews, artifacts),
      getCatalogSnapshot: new GetCatalogSnapshot(artifacts, new KvCatalogSnapshotStore(env.KV)),
      describeScoring: new DescribeScoring(),
      listCatalogFacets: new ListCatalogFacets(artifacts, new KvCatalogFacetCache(env.KV)),
      listSitemapEntries: new ListSitemapEntries(
        artifacts,
        options.supportedLocales ?? ['en'],
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
        new AdaClient(),
        new KvAskRateLimiter(env.KV, {
          ...(config.artifactAskMaxPerIp === undefined
            ? {}
            : { maxPerIp: config.artifactAskMaxPerIp }),
        }),
        config.artifactAskEnabled,
      ),
    },
  }
}
