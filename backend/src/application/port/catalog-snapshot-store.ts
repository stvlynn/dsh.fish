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

  /**
   * The last catalog metadata this store saw.
   *
   * `catalogStats()` heap-scans the wide `artifacts` table, so it is the read
   * that fails first under load. Keeping its last successful result lets
   * `/catalog/version` answer from memory instead of 500ing, which also stops
   * a failing poll endpoint from adding load to the database that is failing.
   */
  readMeta(): Promise<CatalogSnapshotMeta | undefined>
  writeMeta(meta: CatalogSnapshotMeta): Promise<void>

  /**
   * The last snapshot body this store holds, whatever version it was built
   * for.
   *
   * Building the document reads every public artifact row, so it is the
   * heaviest call in the catalog. Keeping one body lets `/catalog/snapshot`
   * answer from memory when D1 refuses the walk, instead of 500ing a document
   * that has not actually changed.
   */
  readLastBody(): Promise<string | undefined>
}
