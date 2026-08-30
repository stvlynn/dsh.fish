/**
 * The install surface shared by the hub plugin and the `@dsh-fish/cli` binary.
 *
 * Importing this module does not load `@deepseek-ai/cordis` or `dsh-tools`, so
 * the CLI can bundle it without pulling in the harness.
 */

export { CLI_CLIENT_ID, CLIENT_ID, HubClient, HubError } from './hub-client.js'
export type {
  ArtifactReviews,
  ArtifactSummary,
  DeviceCodeGrant,
  InstallPlan,
  InstallStep,
  ReviewAuthor,
  ReviewItem,
  ReviewSummary,
} from './hub-client.js'
export { renderArtifactReviews } from './review-text.js'
export {
  InstallRefused,
  PlanInstaller,
  ndjsonError,
  packageNameFromSpec,
  pluginMutationArgs,
  safeJoin,
} from './installer.js'
export type {
  AppliedStep,
  CommandRunner,
  InstallOutcome,
  InstallerHost,
  RemoveOutcome,
} from './installer.js'
export {
  LOCKFILE_VERSION,
  listLocked,
  lockKey,
  lockPath,
  readLock,
  removeLocked,
  upsertLocked,
} from './lockfile.js'
export type { InstallLock, LockedArtifact, LockedPackage } from './lockfile.js'
export { clearToken, dshHome, readToken, writeToken } from './token-store.js'
export type { StoredToken } from './token-store.js'
