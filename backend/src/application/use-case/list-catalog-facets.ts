import type { CatalogFacetCache } from '../port/catalog-facet-cache.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
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
 */
export class ListCatalogFacets {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly cache?: CatalogFacetCache,
  ) {}

  async execute(): Promise<FacetsDto> {
    const cached = await this.cache?.read()
    if (cached !== undefined) return cached
    const facets = await this.loadFromCatalog()
    await this.cache?.write(facets)
    return facets
  }

  private async loadFromCatalog(): Promise<FacetsDto> {
    const [counts, categoryCounts, topicCounts] = await Promise.all([
      this.artifacts.countByKind(),
      this.artifacts.countByCategory?.() ?? Promise.resolve([]),
      this.artifacts.countByTopic?.() ?? Promise.resolve([]),
    ])
    const byKind = new Map(counts.map((entry) => [entry.kind, entry.count]))
    const byCategory = new Map(categoryCounts.map((entry) => [entry.id, entry.count]))
    const byTopic = new Map(topicCounts.map((entry) => [entry.id, entry.count]))
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
}
