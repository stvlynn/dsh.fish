export interface CatalogSnapshotMeta {
  readonly dataVersion: string
  readonly artifactCount: number
  readonly generatedAt: string
}

/**
 * Where a built catalog snapshot body is kept between requests.
 *
 * The snapshot serializes the whole public catalog, so rebuilding it per
 * request would re-read every artifact row to answer what is usually the same
 * document. Keyed by data version, so a stale entry can never be served for a
 * changed catalog — a miss simply rebuilds. Port owned by the application
 * layer; implemented in `infrastructure` over KV.
 */
export interface CatalogSnapshotStore {
  read(dataVersion: string): Promise<string | undefined>
  write(dataVersion: string, body: string): Promise<void>
}
