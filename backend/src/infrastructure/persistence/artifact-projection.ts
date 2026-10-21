import type { Artifact } from '../../domain/artifact/artifact.js'
import { inferTopics, normalizeSearchText } from '../../domain/artifact/topic.js'
import { readmeDigest } from '../../application/lib/readme-digest.js'

/** One storage projection shared by D1 and MySQL adapters. */
export async function projectArtifact(artifact: Artifact) {
    const props = artifact.toProps()
    const readmeMarkdown =
      props.readmeMarkdown?.trim() === '' ? undefined : props.readmeMarkdown
    const summaryHash = await readmeDigest(props.summary)
    const readmeHash =
      readmeMarkdown === undefined ? null : await readmeDigest(readmeMarkdown)
    const topics = inferTopics({
      keywords: props.keywords,
      text: [props.displayName, props.summary, readmeMarkdown ?? ''].join(' '),
    })
    const values = {
      id: props.id as string,
      kind: props.kind,
      displayName: props.displayName,
      summary: props.summary,
      summaryHash,
      readmeHash,
      source: props.source,
      sourceOrigin: props.source.origin,
      sourceCommitSha: props.sourceCommitSha ?? null,
      payload: props.payload,
      keywords: props.keywords,
      categories: props.categories.map(String),
      license: props.license ?? null,
      authorName: props.author?.name ?? null,
      authorUrl: props.author?.url ?? null,
      readmeMarkdown: props.readmeMarkdown ?? null,
      ogImageUrl: props.ogImageUrl ?? null,
      stars: props.stats.stars,
      downloads: props.stats.downloads,
      installs: props.stats.installs,
      starVelocity7d: props.starVelocity7d,
      starVelocity30d: props.starVelocity30d,
      popularity: artifact.popularity,
      ownerAccountId: props.ownerAccountId ?? null,
      deprecated: props.deprecated,
      publishedAt: props.publishedAt,
      updatedAt: props.updatedAt,
      indexedAt: props.indexedAt,
    }

    const haystack = normalizeSearchText([props.displayName, props.summary, ...props.keywords].join(' '))

    return { props, values, topics, haystack, summaryHash, readmeHash }
}
