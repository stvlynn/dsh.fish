import { sourceKey, toEntity } from './submission-row.js'
import { and, desc, eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { SourceRef } from '../../domain/artifact/source-ref.js'
import { Submission } from '../../domain/submission/submission.js'
import type { SubmissionRepository } from '../../domain/submission/submission.js'
import { submissions } from './catalog-schema.js'
import * as schema from './schema.js'

type Db = DrizzleD1Database<typeof schema>

export class D1SubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Submission | undefined> {
    const rows = await this.db.select().from(submissions).where(eq(submissions.id, id)).limit(1)
    const row = rows[0]
    return row ? toEntity(row) : undefined
  }

  async listByAccount(accountId: string): Promise<readonly Submission[]> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.accountId, accountId))
      .orderBy(desc(submissions.createdAt))
      .limit(100)
    return rows.map(toEntity)
  }

  async listPending(limit: number): Promise<readonly Submission[]> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.status, 'pending'))
      .orderBy(desc(submissions.createdAt))
      .limit(limit)
    return rows.map(toEntity)
  }

  async findPendingBySource(source: SourceRef): Promise<Submission | undefined> {
    const rows = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.sourceKey, sourceKey(source)), eq(submissions.status, 'pending')))
      .limit(1)
    const row = rows[0]
    return row ? toEntity(row) : undefined
  }

  async save(submission: Submission): Promise<void> {
    const props = submission.toProps()
    const values = {
      id: props.id,
      accountId: props.accountId,
      kind: props.kind,
      source: props.source,
      sourceKey: sourceKey(props.source),
      note: props.note ?? null,
      status: props.status,
      reviewerNote: props.reviewerNote ?? null,
      artifactId: props.artifactId ?? null,
      createdAt: props.createdAt,
      decidedAt: props.decidedAt ?? null,
    }
    await this.db
      .insert(submissions)
      .values(values)
      .onConflictDoUpdate({ target: submissions.id, set: values })
  }
}
