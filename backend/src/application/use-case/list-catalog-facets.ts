import type { ArtifactRepository, FacetCounts } from '../../domain/artifact/artifact-repository.js'
import { ARTIFACT_KIND_META, ARTIFACT_KINDS } from '../../domain/artifact/artifact-kind.js'
import type { ArtifactKind } from '../../domain/artifact/artifact-kind.js'
import { CATEGORIES } from '../../domain/artifact/category.js'
import { TOPICS } from '../../domain/artifact/topic.js'

export interface FacetsDto {
  readonly kinds: readonly {
    kind: ArtifactKind
    labelKey: string
    descriptionKey: string
    packageManaged: boolean
    count: number
  }[]
  readonly categories: readonly { id: string; labelKey: string; count: number }[]
  readonly topics: readonly { id: string; labelKey: string; count: number }[]
}

/**
 * The filter rails. Every kind is listed even at count zero, so the site can
 * show the taxonomy honestly rather than hiding a type nobody has published yet.
 *
 * Counts are read from the pre-aggregated `catalog_facet_counts` table. Nothing
 * on the request path aggregates the catalog: that is `RefreshCatalogFacets`'s
 * job, on a schedule. If the table was never populated this fails loudly
 * instead of rendering zeroes.
 */
export class ListCatalogFacets {
  constructor(private readonly artifacts: ArtifactRepository) {}

  async execute(): Promise<FacetsDto> {
    const counts = await this.artifacts.readFacetCounts()
    if (counts === undefined) {
      throw new Error('catalog facet counts have never been refreshed; run migration 0015 or the hourly cron')
    }
    return toDto(counts)
  }
}

function toDto(counts: FacetCounts): FacetsDto {
  const byKind = new Map(counts.kinds.map((entry) => [entry.kind, entry.count]))
  const byCategory = new Map(counts.categories.map((entry) => [entry.id, entry.count]))
  const byTopic = new Map(counts.topics.map((entry) => [entry.id, entry.count]))
  return {
    kinds: ARTIFACT_KINDS.map((kind) => ({
      kind,
      labelKey: ARTIFACT_KIND_META[kind].labelKey,
      descriptionKey: ARTIFACT_KIND_META[kind].descriptionKey,
      packageManaged: ARTIFACT_KIND_META[kind].packageManaged,
      count: byKind.get(kind) ?? 0,
    })),
    categories: CATEGORIES.map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey,
      count: byCategory.get(entry.id) ?? 0,
    })),
    topics: TOPICS.map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey,
      count: byTopic.get(entry.id) ?? 0,
    })),
  }
}
