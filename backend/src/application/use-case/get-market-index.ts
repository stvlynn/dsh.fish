/**
 * The public catalog rendered as a DSH plugin-market index (format 1).
 *
 * The harness's Plugin Market bundle discovers plugins by fetching an "index"
 * URL: a JSON document with `format: 1` listing plugins, their versions, and
 * where each version installs from. Registering dsh.fish as one of those
 * sources is the difference between "the catalog is a website" and "the
 * catalog is a marketplace the harness itself can browse and install from".
 *
 * The format is defined by DSH, not by us, so this module's whole job is
 * translation: our `Artifact` domain shapes in, DSH's `MarketIndex` shape out.
 * It deliberately does not add fields DSH does not understand — a reader drops
 * unknown members, so anything extra would be dead weight that looks
 * authoritative.
 *
 * Two projections deserve a note:
 *
 * - **Versions.** DSH requires a non-empty version list in descending SemVer
 *   precedence, each with a publish timestamp and an install source. The
 *   catalog records one current version per artifact (`latestVersion` for npm,
 *   the pinned `commit` for GitHub), so each artifact contributes exactly one
 *   version. That is honest: we publish what we crawled, and inventing older
 *   releases we never verified would offer installs that were never tested.
 * - **Kinds.** Only `bundle` and `profile` artifacts are installable through
 *   the market's own install path, which shells out to a package manager.
 *   Skills and agent presets are files, not packages, and DSH's market format
 *   has no way to express "write this file" — so they are excluded here and
 *   stay reachable through the dsh.fish plugin's own tools.
 */

import type { Artifact } from '../../domain/artifact/artifact.js'
import type { ArtifactRepository } from '../../domain/artifact/artifact-repository.js'
import type { ArtifactSummaryDto } from '../dto/artifact-dto.js'
import { toSummaryDto } from '../dto/artifact-dto.js'

/** A market-declared category: an opaque id plus display text. */
export interface MarketDeclaration {
  readonly title: { readonly en: string }
}

/** One install source, as DSH's format 1 defines it. */
export type MarketSource =
  | { readonly type: 'npm'; readonly registry?: string }
  | {
      readonly type: 'git'
      readonly url: string
      readonly commit: string
      readonly path?: string
    }

export interface MarketVersion {
  readonly version: string
  /** Publish time in Unix seconds. */
  readonly publishTimestamp: number
  readonly source: MarketSource
  readonly engines: { readonly dsh?: string }
}

export interface MarketPlugin {
  readonly name: string
  readonly title?: { readonly en: string }
  readonly description?: { readonly en: string }
  readonly homepage?: string
  readonly author?: string
  readonly repository?: { readonly url: string; readonly directory?: string }
  readonly metadata: {
    readonly category?: string
    readonly keywords: readonly string[]
    readonly labels: readonly string[]
    readonly sortKeys: Readonly<Record<string, number>>
  }
  readonly versions: readonly MarketVersion[]
}

export interface MarketIndex {
  readonly format: 1
  readonly title: { readonly en: string }
  readonly description?: { readonly en: string }
  readonly metadata: {
    readonly categories: Readonly<Record<string, MarketDeclaration>>
    readonly labels: Readonly<Record<string, MarketDeclaration>>
    readonly sortKeys: Readonly<
      Record<string, { readonly title: { readonly en: string }; readonly order: 'asc' | 'desc' }>
    >
  }
  readonly plugins: readonly MarketPlugin[]
}

/** Public URL the index advertises as each artifact's page. */
const SITE_ORIGIN = 'https://dsh.fish'

/** DSH versions these packages are built for. */
const DSH_ENGINE_RANGE = '>=0.2.1-rc.2'

/**
 * Project the public catalog into a plugin-market index.
 *
 * @param artifacts - every publicly visible artifact (the same rows a snapshot serves).
 * @returns a format-1 index; deterministic for a given catalog.
 */
export function buildMarketIndex(artifacts: readonly Artifact[]): MarketIndex {
  const plugins: MarketPlugin[] = []
  const categories = new Map<string, MarketDeclaration>()

  for (const artifact of artifacts) {
    const plugin = toMarketPlugin(artifact)
    if (plugin === undefined) continue
    plugins.push(plugin)
    for (const category of artifact.categories) {
      const id = String(category)
      if (!categories.has(id)) categories.set(id, { title: { en: categoryLabel(id) } })
    }
  }

  // Index order is the market's default order. The catalog's own ordering is
  // quality-ranked, which is what a browser should see first.
  return {
    format: 1,
    title: { en: 'dsh.fish' },
    description: {
      en: 'DeepSeek Harness plugins, profiles and skills discovered and scored by dsh.fish.',
    },
    metadata: {
      categories: Object.fromEntries([...categories].sort(([a], [b]) => a.localeCompare(b))),
      labels: {},
      sortKeys: {},
    },
    plugins,
  }
}

/**
 * One artifact as a market plugin, or undefined when the market cannot install it.
 *
 * @param artifact - the catalog row.
 * @returns the plugin entry, or undefined for a kind or source the format cannot express.
 */
export function toMarketPlugin(artifact: Artifact): MarketPlugin | undefined {
  const summary = toSummaryDto(artifact)
  const version = toMarketVersion(artifact, summary)
  if (version === undefined) return undefined

  const repository = repositoryOf(artifact)
  const author = artifact.author?.name

  return {
    name: summary.id,
    title: { en: summary.displayName },
    description: { en: summary.summary },
    homepage: `${SITE_ORIGIN}/a/${encodeURIComponent(summary.id)}`,
    ...(author === undefined ? {} : { author }),
    ...(repository === undefined ? {} : { repository }),
    metadata: {
      ...(summary.categories[0] === undefined ? {} : { category: summary.categories[0] }),
      keywords: summary.keywords,
      labels: [],
      sortKeys: {},
    },
    versions: [version],
  }
}

/**
 * One installable version of an artifact.
 *
 * @returns the version, or undefined when the artifact has no package identity
 *   (a submission-only row) or is a kind the market's package-manager install
 *   cannot express.
 */
function toMarketVersion(
  artifact: Artifact,
  summary: ArtifactSummaryDto,
): MarketVersion | undefined {
  if (artifact.kind !== 'bundle' && artifact.kind !== 'profile') return undefined

  const source = artifact.source
  if (source.origin === 'npm') {
    return {
      version: source.latestVersion,
      publishTimestamp: publishedSeconds(summary.updatedAt),
      source: { type: 'npm' },
      engines: { dsh: DSH_ENGINE_RANGE },
    }
  }

  if (source.origin === 'github') {
    // The format pins a git install to a full 40-hex commit. A row crawled
    // before we learned its commit cannot be installed reproducibly, so it is
    // withheld rather than offered unpinned — the same rule the install plan
    // already warns about.
    const commit = artifact.sourceCommitSha ?? source.commit
    if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) return undefined
    return {
      // The catalog records no release history for a git source, so the pinned
      // commit is the only honest version identity. The short SHA is stable and
      // satisfies SemVer-ish ordering for a single-version list.
      version: semanticVersionForCommit(commit),
      publishTimestamp: publishedSeconds(summary.updatedAt),
      source: {
        type: 'git',
        url: `https://github.com/${source.owner}/${source.repo}`,
        commit,
        ...(source.path === undefined ? {} : { path: source.path }),
      },
      engines: { dsh: DSH_ENGINE_RANGE },
    }
  }

  // A submission-only row names a homepage, not a package: nothing to install.
  return undefined
}

/**
 * A version string for an artifact whose only identity is a commit.
 *
 * DSH requires each version to be exact SemVer. A git-crawled row has no
 * published version, so the commit's leading hex digits become a prerelease
 * identifier — deterministic, unique per commit, and visibly not a release.
 *
 * The `c` prefix is load-bearing, not decoration. SemVer forbids leading zeros
 * in a numeric prerelease identifier, and a SHA that happens to be all digits
 * (`042209259139…`) is parsed as numeric: `0.0.0-commit.042209259139` is
 * rejected as "must be an exact SemVer version" and takes the whole index down
 * with it, because DSH drops the entire document on the first violation. A
 * leading letter makes the identifier alphanumeric, where leading zeros are
 * legal. Roughly one commit in six starts with a digit, so this is not a rare
 * edge: it surfaced on the 1,896th of 8,367 real plugins.
 */
function semanticVersionForCommit(commit: string): string {
  return `0.0.0-commit.c${commit.slice(0, 12)}`
}

/** ISO timestamp to the Unix seconds the format requires. */
function publishedSeconds(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

/** The repository a market card links to, when the source names one. */
function repositoryOf(
  artifact: Artifact,
): { readonly url: string; readonly directory?: string } | undefined {
  const source = artifact.source
  if (source.origin !== 'github') return undefined
  return {
    url: `https://github.com/${source.owner}/${source.repo}`,
    ...(source.path === undefined ? {} : { directory: source.path }),
  }
}

/**
 * Human label for a category id.
 *
 * The catalog's ids are kebab-case slugs; the market shows a title, so this
 * turns `dev-tools` into `Dev tools`. It is derived rather than looked up
 * because the category taxonomy already has display copy in the frontend
 * catalogs, and duplicating it here would be a second source of truth that
 * drifts silently.
 */
function categoryLabel(id: string): string {
  const words = id.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Read the catalog and render it as a format-1 index.
 *
 * Served from the same `listForSnapshot` read the catalog snapshot uses, so the
 * market and the snapshot describe one consistent catalog.
 */
export class GetMarketIndex {
  constructor(private readonly artifacts: ArtifactRepository) {}

  async index(): Promise<MarketIndex> {
    const rows = await this.artifacts.listForSnapshot()
    return buildMarketIndex(rows)
  }
}
