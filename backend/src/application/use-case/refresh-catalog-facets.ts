import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'

/**
 * Rebuilds the pre-aggregated filter-rail counts. Scheduled, not per-request:
 * it is the single place the catalog is aggregated for the rails (see ADR 0009).
 */
export class RefreshCatalogFacets {
  constructor(private readonly artifacts: ArtifactRepository) {}

  async execute(): Promise<void> {
    await this.artifacts.refreshFacetCounts()
  }
}
