import { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactProps } from '../../domain/artifact/artifact.js'
import { artifactKind } from '../../domain/artifact/artifact-kind.js'
import type { ArtifactPayload } from '../../domain/artifact/artifact-payload.js'
import type { SourceRef } from '../../domain/artifact/source-ref.js'
import { slug } from '../../domain/shared/slug.js'
import type { artifacts } from './catalog-schema.js'

type ArtifactRow = typeof artifacts.$inferSelect

export function toListingEntity(row: Omit<ArtifactRow, 'readmeMarkdown'> & { hasReadme: number }): Artifact {
  const { hasReadme, ...rest } = row
  return toEntity({
    ...rest,
    readmeMarkdown: Number(hasReadme) === 0 ? null : '#',
  })
}

export function toEntity(row: ArtifactRow): Artifact {
  const props: ArtifactProps = {
    id: slug(row.id),
    kind: artifactKind(row.kind),
    displayName: row.displayName,
    summary: row.summary,
    source: row.source as SourceRef,
    ...(row.sourceCommitSha === null ? {} : { sourceCommitSha: row.sourceCommitSha }),
    payload: row.payload as ArtifactPayload,
    keywords: (row.keywords as string[]) ?? [],
    categories: ((row.categories as string[]) ?? []).map((value) => slug(value)),
    ...(row.license === null ? {} : { license: row.license }),
    ...(row.authorName === null
      ? {}
      : { author: { name: row.authorName, ...(row.authorUrl === null ? {} : { url: row.authorUrl }) } }),
    ...(row.readmeMarkdown === null ? {} : { readmeMarkdown: row.readmeMarkdown }),
    ...(row.ogImageUrl === null ? {} : { ogImageUrl: row.ogImageUrl }),
    stats: { stars: row.stars, downloads: row.downloads, installs: row.installs },
    starVelocity7d: row.starVelocity7d,
    starVelocity30d: row.starVelocity30d,
    ...(row.ownerAccountId === null ? {} : { ownerAccountId: row.ownerAccountId }),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    indexedAt: row.indexedAt,
    deprecated: row.deprecated,
  }
  return Artifact.rehydrate(props)
}
