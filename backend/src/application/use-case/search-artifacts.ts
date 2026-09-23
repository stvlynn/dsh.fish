import type {
  ArtifactQuery,
  ArtifactRepository,
  ArtifactSort,
} from '../../domain/artifact/artifact-repository.js'
import { artifactKind } from '../../domain/artifact/artifact-kind.js'
import { category } from '../../domain/artifact/category.js'
import type { SummaryTranslationRepository } from '../../domain/artifact/summary-translation.js'
import { DomainError } from '../../domain/shared/error.js'
import { pageRequest } from '../../domain/shared/pagination.js'
import type { ArtifactSummaryDto, PageDto } from '../dto/artifact-dto.js'
import { toPageDto, toSummaryDto } from '../dto/artifact-dto.js'
import { translatedSummary } from '../lib/localized-prose.js'
import { isTopic } from '../../domain/artifact/topic.js'

export interface SearchArtifactsInput {
  readonly text?: string
  readonly kinds?: readonly string[]
  readonly categories?: readonly string[]
  readonly topics?: readonly string[]
  readonly verifiedOnly?: boolean
  readonly includeDeprecated?: boolean
  readonly sort?: string
  readonly limit?: number
  readonly offset?: number
  /** When set, summaries use this locale's generated prose when any remains on the row. */
  readonly locale?: string
}

/** KV-backed cache for the fixed home-page rails. Owned by this use case. */
export interface HomeRailCache {
  read(
    sort: string,
    limit: number,
    locale: string,
  ): Promise<PageDto<ArtifactSummaryDto> | undefined>
  write(
    sort: string,
    limit: number,
    locale: string,
    page: PageDto<ArtifactSummaryDto>,
  ): Promise<void>
}

const SORTS: readonly ArtifactSort[] = ['relevance', 'popular', 'recent', 'name', 'rising']

/**
 * The one read path behind the site's browse page, the home page rails, the
 * `@dsh-fish/hub` plugin's `hub_search` tool, and `@dsh-fish/cli find`. Sharing it is
 * what keeps the agent's view of the catalog identical to the human's.
 */
export class SearchArtifacts {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly summaryTranslations: SummaryTranslationRepository,
    private readonly homeRailCache?: HomeRailCache,
  ) {}

  async execute(input: SearchArtifactsInput): Promise<PageDto<ArtifactSummaryDto>> {
    const query: ArtifactQuery = {
      ...(input.text === undefined || input.text.trim() === ''
        ? {}
        : { text: input.text.trim().slice(0, 200) }),
      ...(input.kinds === undefined || input.kinds.length === 0
        ? {}
        : { kinds: input.kinds.map((value) => artifactKind(value)) }),
      ...(input.categories === undefined || input.categories.length === 0
        ? {}
        : { categories: input.categories.map(assertCategory) }),
      ...(input.topics === undefined || input.topics.length === 0
        ? {}
        : { topics: input.topics.map(assertTopic) }),
      ...(input.locale === undefined ? {} : { locale: input.locale }),
      ...(input.verifiedOnly === undefined ? {} : { verifiedOnly: input.verifiedOnly }),
      ...(input.includeDeprecated === undefined
        ? {}
        : { includeDeprecated: input.includeDeprecated }),
      sort: resolveSort(input.sort, input.text),
      page: pageRequest(input.limit, input.offset),
    }

    // The home rails are a fixed trio of unfiltered queries and the heaviest
    // reads on the site. Caching them keeps a crawl from re-reading tens of
    // thousands of rows per page view; any filtered or text search bypasses it.
    const rail =
      this.homeRailCache !== undefined &&
      input.text === undefined &&
      (input.kinds === undefined || input.kinds.length === 0) &&
      (input.categories === undefined || input.categories.length === 0) &&
      (input.topics === undefined || input.topics.length === 0) &&
      input.verifiedOnly === undefined &&
      input.includeDeprecated !== true &&
      input.locale !== undefined &&
      input.offset === undefined
        ? { sort: query.sort, limit: query.page.limit, locale: input.locale }
        : undefined
    if (rail !== undefined) {
      const cached = await this.homeRailCache!.read(rail.sort, rail.limit, rail.locale)
      if (cached !== undefined) return cached
    }

    const result = await this.artifacts.search(query)
    if (input.locale === undefined || result.items.length === 0) {
      const page = toPageDto(result, toSummaryDto)
      if (rail !== undefined) await this.homeRailCache!.write(rail.sort, rail.limit, rail.locale, page)
      return page
    }

    const translations = await this.summaryTranslations.listFor(
      result.items.map((item) => item.id),
      input.locale,
    )
    const byArtifact = new Map(translations.map((row) => [String(row.artifactId), row]))
    const summaryByArtifact = new Map(
      result.items.map((artifact) => [
        String(artifact.id),
        translatedSummary(byArtifact.get(String(artifact.id))) ?? artifact.summary,
      ]),
    )
    const page = toPageDto(result, (artifact) => ({
      ...toSummaryDto(artifact),
      summary: summaryByArtifact.get(String(artifact.id)) ?? artifact.summary,
    }))
    if (rail !== undefined) await this.homeRailCache!.write(rail.sort, rail.limit, rail.locale, page)
    return page
  }
}

function assertTopic(raw: string) {
  if (!isTopic(raw)) {
    throw DomainError.invalid('Unknown topic.', { raw })
  }
  return raw
}

function assertCategory(raw: string) {
  return category(raw).id
}

/**
 * Relevance only means something with a query behind it; an empty search sorted
 * by relevance would otherwise return an arbitrary page.
 */
function resolveSort(raw: string | undefined, text: string | undefined): ArtifactSort {
  const hasText = text !== undefined && text.trim() !== ''
  if (raw === undefined) return hasText ? 'relevance' : 'popular'
  const match = SORTS.find((sort) => sort === raw)
  if (!match) {
    throw DomainError.invalid('Unknown sort.', { raw, supported: SORTS })
  }
  if (match === 'relevance' && !hasText) return 'popular'
  return match
}
