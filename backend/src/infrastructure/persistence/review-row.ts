import { Review } from '../../domain/review/review.js'
import type { ReviewProps } from '../../domain/review/review.js'
import type { artifactReviews } from './catalog-schema.js'

export function toEntity(row: typeof artifactReviews.$inferSelect): Review {
  const props: ReviewProps = {
    artifactId: row.artifactId,
    accountId: row.accountId,
    authorName: row.authorName,
    ...(row.authorAvatarUrl === null ? {} : { authorAvatarUrl: row.authorAvatarUrl }),
    rating: row.rating,
    ...(row.comment === null ? {} : { comment: row.comment }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  return Review.rehydrate(props)
}
