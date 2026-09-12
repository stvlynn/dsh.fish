/**
 * Bump when the model or translation policy changes.
 *
 * Including the revision in the digest makes stored rows stale for
 * scheduling, so a backfill re-queues every earlier generated README.
 * A changed policy clears the previous body when the replacement is queued,
 * preventing output from a retired or invalid policy from being served.
 */
export const README_TRANSLATION_POLICY_VERSION = 'lm-studio-hy-mt2-1.8b-chunked-v3'

/** Stable identity for the exact README bytes and translation policy. */
export async function readmeDigest(markdown: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${README_TRANSLATION_POLICY_VERSION}\0${markdown}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
