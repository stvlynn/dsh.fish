import { Submission } from '../../domain/submission/submission.js'
import type { SubmissionProps, SubmissionStatus } from '../../domain/submission/submission.js'
import { artifactKind } from '../../domain/artifact/artifact-kind.js'
import type { SourceRef } from '../../domain/artifact/source-ref.js'
import type { submissions } from './catalog-schema.js'

/** Stable identity for a source, so two spellings of the same repo collide. */
export function sourceKey(source: SourceRef): string {
  switch (source.origin) {
    case 'npm':
      return `npm:${source.packageName.toLowerCase()}`
    case 'github':
      return `github:${source.owner.toLowerCase()}/${source.repo.toLowerCase()}${
        source.path === undefined ? '' : `/${source.path.toLowerCase()}`
      }`
    case 'submission':
      return `url:${source.homepageUrl.toLowerCase()}`
  }
}


export function toEntity(row: typeof submissions.$inferSelect): Submission {
  const props: SubmissionProps = {
    id: row.id,
    accountId: row.accountId,
    kind: artifactKind(row.kind),
    source: row.source as SourceRef,
    ...(row.note === null ? {} : { note: row.note }),
    status: row.status as SubmissionStatus,
    ...(row.reviewerNote === null ? {} : { reviewerNote: row.reviewerNote }),
    ...(row.artifactId === null ? {} : { artifactId: row.artifactId }),
    createdAt: row.createdAt,
    ...(row.decidedAt === null ? {} : { decidedAt: row.decidedAt }),
  }
  return Submission.rehydrate(props)
}
