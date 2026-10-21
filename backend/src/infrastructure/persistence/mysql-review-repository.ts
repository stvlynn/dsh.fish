import { toEntity } from './review-row.js'
import { count, desc, eq } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { Review } from '../../domain/review/review.js'
import type {
  RatingDistribution,
  ReviewRepository,
  ReviewSummary,
} from '../../domain/review/review.js'
import { artifactReviews } from './mysql-schema.js'
import * as schema from './mysql-schema.js'

type Db = MySql2Database<typeof schema>

export class MysqlReviewRepository implements ReviewRepository {
  constructor(private readonly db: Db) {}

  async save(review: Review): Promise<void> {
    const props = review.toProps()
    await this.db
      .insert(artifactReviews)
      .values({
        artifactId: props.artifactId,
        accountId: props.accountId,
        authorName: props.authorName,
        authorAvatarUrl: props.authorAvatarUrl ?? null,
        rating: props.rating,
        comment: props.comment ?? null,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
      })
      .onDuplicateKeyUpdate({
        // A re-rate keeps the original `createdAt`: that is when this account
        // first spoke, while `updatedAt` tracks the latest wording.
        set: {
          authorName: props.authorName,
          authorAvatarUrl: props.authorAvatarUrl ?? null,
          rating: props.rating,
          comment: props.comment ?? null,
          updatedAt: props.updatedAt,
        },
      })
  }

  async listByArtifact(artifactId: string, limit: number): Promise<readonly Review[]> {
    const rows = await this.db
      .select()
      .from(artifactReviews)
      .where(eq(artifactReviews.artifactId, artifactId))
      .orderBy(desc(artifactReviews.updatedAt))
      .limit(limit)
    return rows.map(toEntity)
  }

  async summarize(artifactId: string): Promise<ReviewSummary> {
    const rows = await this.db
      .select({ rating: artifactReviews.rating, n: count() })
      .from(artifactReviews)
      .where(eq(artifactReviews.artifactId, artifactId))
      .groupBy(artifactReviews.rating)
    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0]
    let total = 0
    let sum = 0
    for (const row of rows) {
      if (row.rating >= 1 && row.rating <= 5) {
        distribution[row.rating - 1] = row.n
        total += row.n
        sum += row.rating * row.n
      }
    }
    return {
      ...(total === 0 ? {} : { average: Math.round((sum / total) * 10) / 10 }),
      count: total,
      distribution: distribution as RatingDistribution,
    }
  }
}
