const SHARD_COUNT = 4

export function readmeI18nShardName(artifactId: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < artifactId.length; index += 1) {
    hash ^= artifactId.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `lm-studio-${(hash >>> 0) % SHARD_COUNT}`
}
