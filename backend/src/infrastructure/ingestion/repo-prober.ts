import { parse as parseYaml } from 'yaml'
import { classifyPackage, parseSkillFrontmatter } from '../../domain/artifact/manifest.js'
import type { PackageManifest } from '../../domain/artifact/manifest.js'
import type { ArtifactKind } from '../../domain/artifact/artifact-kind.js'
import type { ArtifactPayload } from '../../domain/artifact/artifact-payload.js'
import { resolveCategories } from '../../domain/artifact/category-inference.js'
import { githubSource, isNpmPackageName, releaseTarballTarget } from '../../domain/artifact/source-ref.js'
import type { SourceRef, VerifiedNpmBinding } from '../../domain/artifact/source-ref.js'
import { slugify } from '../../domain/shared/slug.js'
import type { IndexedSnapshot } from '../../application/port/source-indexer.js'
import { GitHubSocialPreview } from './github-social-preview.js'
import { lookupNpmBinding } from './npm-binding.js'
import type { NpmBindingLookup } from './npm-binding.js'

/** The topic the harness README asks plugin authors to tag their repositories with. */
export const DSH_PLUGIN_TOPIC = 'dsh-plugin'

const API = 'https://api.github.com'

/** The three files that make a repository something the harness can load. */
const MANIFEST_FILE = 'package.json'
const SKILL_FILE = 'SKILL.md'
const PRESET_FILE = 'agent.cordis.yml'

/**
 * The repository metadata a probe needs, as the GitHub API reports it. Both a
 * search result item and a `/repos/{owner}/{repo}` response satisfy this
 * shape, which is what lets the topic crawl and the curated-list crawl share
 * one prober.
 */
export interface RepoDescriptor {
  full_name: string
  name: string
  owner: { id: number; login: string; html_url: string; avatar_url: string }
  description: string | null
  stargazers_count: number
  license: { spdx_id: string } | null
  topics?: string[]
  default_branch: string
  pushed_at: string
  archived: boolean
}

/** Facts every snapshot shares, whatever probe proved the repository. */
interface RepoFacts {
  readonly keywords: readonly string[]
  readonly author: { readonly name: string; readonly url: string }
  readonly sourceOwnerId: string
  readonly stats: { readonly stars: number; readonly downloads: number }
  readonly deprecated: boolean
  readonly license?: string
}

/** The probes, named so a kind hint can reorder them. */
type ProbeName = 'manifest' | 'skill' | 'preset'

/**
 * The default probe order, rotated when a submission carries a kind hint. A
 * hint only changes what is read first — every kind still needs its content
 * proof, so a hinted probe that finds nothing falls through to the rest. Hints
 * for the package-manifest kinds (bundle, profile)
 * change nothing: those are all decided by the same package.json read.
 */
function orderProbes(kindHint: ArtifactKind | undefined): readonly ProbeName[] {
  if (kindHint === 'skill') return ['skill', 'manifest', 'preset']
  if (kindHint === 'agent-preset') return ['preset', 'manifest', 'skill']
  return ['manifest', 'skill', 'preset']
}

/**
 * Classifies a GitHub repository by what it actually contains, not by what it
 * claims: a `package.json` with `dsh.bundle` is a bundle, a `SKILL.md` is a
 * skill, an `agent.cordis.yml` is a preset. A repository holding none of those
 * yields nothing, because the harness would load nothing from it either.
 *
 * The probes run before anything else is fetched, and a repository that fails
 * all three costs three reads of `raw.githubusercontent.com` and no API quota
 * at all — the discovery channels (topic search, curated lists) both surface
 * far more applications than loadable plugins.
 */
/** Install hints a curated list already recorded for this repository. */
export interface CuratedInstallHints {
  readonly npm?: string
  readonly tarball?: string
}

export class RepoProber {
  constructor(
    private readonly token?: string,
    private readonly socialPreview: GitHubSocialPreview = new GitHubSocialPreview(token),
    private readonly lookupNpm: NpmBindingLookup = lookupNpmBinding,
  ) {}

  /** Fetch one repository's metadata; undefined when it is gone or private. */
  async fetchRepo(owner: string, repo: string): Promise<RepoDescriptor | undefined> {
    const response = await this.get(`${API}/repos/${owner}/${repo}`)
    if (!response) return undefined
    return (await response.json()) as RepoDescriptor
  }

  async indexRepository(
    repo: RepoDescriptor,
    subPath?: string,
    kindHint?: ArtifactKind,
    curatedCategories: readonly string[] = [],
    curatedInstall: CuratedInstallHints = {},
  ): Promise<IndexedSnapshot | undefined> {
    const ref = repo.default_branch
    const prefix = subPath === undefined || subPath === '' ? '' : `${subPath}/`
    const topics = repo.topics?.filter((topic) => topic !== DSH_PLUGIN_TOPIC) ?? []

    const base: RepoFacts = {
      keywords: topics,
      author: { name: repo.owner.login, url: repo.owner.html_url },
      // The numeric id, not the login: it is what an OAuth link records, and it
      // survives the owner renaming themselves.
      sourceOwnerId: String(repo.owner.id),
      stats: { stars: repo.stargazers_count, downloads: 0 },
      deprecated: repo.archived,
      ...(repo.license?.spdx_id ? { license: repo.license.spdx_id } : {}),
    }

    for (const probe of orderProbes(kindHint)) {
      const snapshot =
        probe === 'manifest'
          ? await this.probeManifest(
              repo,
              prefix,
              ref,
              subPath,
              base,
              topics,
              curatedCategories,
              curatedInstall,
            )
          : probe === 'skill'
            ? await this.probeSkill(repo, prefix, ref, subPath, base, topics, curatedCategories)
            : await this.probePreset(repo, prefix, ref, subPath, base, curatedCategories)
      if (snapshot) return snapshot
    }
    return undefined
  }

  /** The package manifest: bundle or profile. */
  private async probeManifest(
    repo: RepoDescriptor,
    prefix: string,
    ref: string,
    subPath: string | undefined,
    base: RepoFacts,
    topics: readonly string[],
    curatedCategories: readonly string[],
    curatedInstall: CuratedInstallHints,
  ): Promise<IndexedSnapshot | undefined> {
    const manifestText = await this.readFile(repo, `${prefix}${MANIFEST_FILE}`, ref)
    if (manifestText === undefined) return undefined
    const manifest = safeJson<PackageManifest>(manifestText)
    if (!manifest) return undefined
    const classification = classifyPackage(manifest, true)
    if (!classification) return undefined

    const context = await this.loadContext(repo, subPath, prefix, ref)
    const source = await this.withInstallTargets(context.source, manifest.name, curatedInstall)
    const keywords = [...topics, ...(manifest.keywords ?? [])]
    return {
      id: slugify(manifest.name),
      kind: classification.kind,
      displayName: manifest.name,
      summary: manifest.description ?? repo.description ?? manifest.name,
      source,
      payload: classification.payload,
      ...base,
      keywords,
      categories: resolveCategories(
        manifest.dsh?.hub?.categories?.map(String) ?? [],
        {
          keywords,
          text: `${manifest.name} ${manifest.description ?? repo.description ?? ''}`,
        },
        curatedCategories,
      ),
      ...(manifest.license ? { license: manifest.license } : {}),
      ...(context.readme === undefined ? {} : { readmeMarkdown: context.readme }),
      ogImageUrl: context.ogImageUrl,
      ...(context.head === undefined ? {} : { sourceCommitSha: context.head }),
    }
  }

  /** A skill: `SKILL.md` at the indexed root. */
  private async probeSkill(
    repo: RepoDescriptor,
    prefix: string,
    ref: string,
    subPath: string | undefined,
    base: RepoFacts,
    topics: readonly string[],
    curatedCategories: readonly string[],
  ): Promise<IndexedSnapshot | undefined> {
    const skillText = await this.readFile(repo, `${prefix}${SKILL_FILE}`, ref)
    if (skillText === undefined) return undefined
    const frontmatter = readFrontmatter(skillText)
    if (!frontmatter) return undefined
    const parsed = parseSkillFrontmatter(frontmatter)
    const context = await this.loadContext(repo, subPath, prefix, ref)
    const payload: ArtifactPayload = {
      kind: 'skill',
      skillName: parsed.name,
      layout: 'directory',
      files: [
        {
          path: SKILL_FILE,
          downloadUrl: rawUrl(repo, `${prefix}${SKILL_FILE}`, context.head ?? ref),
        },
      ],
    }
    return {
      id: slugify(`${repo.owner.login}-${parsed.name}`),
      kind: 'skill',
      displayName: parsed.name,
      summary: parsed.description,
      source: context.source,
      payload,
      ...base,
      // A skill declares no manifest, so its own name and description are
      // the whole vocabulary there is to file it by.
      categories: resolveCategories(
        [],
        {
          keywords: topics,
          text: `${parsed.name} ${parsed.description}`,
        },
        curatedCategories,
      ),
      ...(context.readme === undefined ? {} : { readmeMarkdown: context.readme }),
      ogImageUrl: context.ogImageUrl,
      ...(context.head === undefined ? {} : { sourceCommitSha: context.head }),
    }
  }

  /** An agent preset: a directory holding one `agent.cordis.yml`. */
  private async probePreset(
    repo: RepoDescriptor,
    prefix: string,
    ref: string,
    subPath: string | undefined,
    base: RepoFacts,
    curatedCategories: readonly string[],
  ): Promise<IndexedSnapshot | undefined> {
    const presetText = await this.readFile(repo, `${prefix}${PRESET_FILE}`, ref)
    if (presetText === undefined) return undefined
    const context = await this.loadContext(repo, subPath, prefix, ref)
    const presetId = slugify(repo.name)
    const payload: ArtifactPayload = {
      kind: 'agent-preset',
      presetId,
      compositionUrl: rawUrl(repo, `${prefix}${PRESET_FILE}`, context.head ?? ref),
    }
    return {
      id: slugify(`${repo.owner.login}-${repo.name}`),
      kind: 'agent-preset',
      displayName: repo.name,
      summary: repo.description ?? repo.name,
      source: context.source,
      payload,
      ...base,
      categories: resolveCategories(
        [],
        {
          keywords: base.keywords,
          text: `${repo.name} ${repo.description ?? ''}`,
        },
        curatedCategories,
      ),
      ...(context.readme === undefined ? {} : { readmeMarkdown: context.readme }),
      ogImageUrl: context.ogImageUrl,
      ...(context.head === undefined ? {} : { sourceCommitSha: context.head }),
    }
  }

  /**
   * Attach a verified npm name and a same-repo Release tarball when either
   * can be proven. The install plan reads these; it does not guess from the
   * display name. A packument whose `repository` is a different remote is
   * ignored (name-squatting). Network failure leaves the fields off so a
   * later sweep can fill them without wiping a previous binding (merge keeps
   * the stored npm/tarball when the next crawl omits them).
   */
  private async withInstallTargets(
    source: SourceRef,
    packageName: string | undefined,
    curated: CuratedInstallHints,
  ): Promise<SourceRef> {
    if (source.origin !== 'github') return source
    const names = [curated.npm, packageName].filter(
      (name): name is string => typeof name === 'string' && isNpmPackageName(name),
    )
    let npm: VerifiedNpmBinding | undefined
    for (const name of [...new Set(names)]) {
      npm = await this.lookupNpm(name, source.owner, source.repo)
      if (npm !== undefined) break
    }
    const releaseTarball =
      curated.tarball === undefined
        ? undefined
        : releaseTarballTarget(curated.tarball, `${source.owner}/${source.repo}`)
    if (npm === undefined && releaseTarball === undefined) return source
    return githubSource({
      owner: source.owner,
      repo: source.repo,
      ...(source.path === undefined ? {} : { path: source.path }),
      ...(source.commit === undefined ? {} : { commit: source.commit }),
      ...(source.via === undefined ? {} : { via: source.via }),
      ...(npm === undefined ? {} : { npm }),
      ...(releaseTarball === undefined ? {} : { releaseTarball }),
    })
  }

  /**
   * The commit, source reference and readme — everything a row needs that a
   * repository which turns out not to be a plugin should never be charged for.
   */
  private async loadContext(
    repo: RepoDescriptor,
    subPath: string | undefined,
    prefix: string,
    ref: string,
  ): Promise<{ source: SourceRef; head?: string; readme?: string; ogImageUrl: string }> {
    const head = await this.resolveCommit(repo.owner.login, repo.name, ref)
    const readme = await this.readFile(repo, `${prefix}README.md`, ref)
    const ogImageUrl = await this.socialPreview.read(repo.owner.login, repo.name, head)
    return {
      source: githubSource({
        owner: repo.owner.login,
        repo: repo.name,
        ...(subPath === undefined || subPath === '' ? {} : { path: subPath }),
        ...(head === undefined ? {} : { commit: head }),
      }),
      ...(head === undefined ? {} : { head }),
      ...(readme === undefined ? {} : { readme }),
      ogImageUrl,
    }
  }

  private async resolveCommit(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<string | undefined> {
    const response = await this.get(`${API}/repos/${owner}/${repo}/commits/${ref}`)
    if (!response) return undefined
    const body = (await response.json()) as { sha?: string }
    return typeof body.sha === 'string' ? body.sha : undefined
  }

  private async readFile(
    repo: RepoDescriptor,
    path: string,
    ref: string,
  ): Promise<string | undefined> {
    const response = await this.get(rawUrl(repo, path, ref), { accept: 'text/plain' })
    if (!response) return undefined
    const text = await response.text()
    return text.length > 200_000 ? text.slice(0, 200_000) : text
  }

  /**
   * GET with the indexer's headers; undefined on any non-OK response. Public
   * so discovery crawls can issue their own queries (the topic search page)
   * with the same credentials and user-agent as the probes.
   */
  async get(
    url: string,
    options: { accept?: string } = {},
  ): Promise<Response | undefined> {
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/vnd.github+json',
      'user-agent': 'dsh.fish-indexer',
    }
    if (this.token !== undefined) {
      headers['authorization'] = `Bearer ${this.token}`
    }
    const response = await fetch(url, { headers })
    if (!response.ok) return undefined
    return response
  }
}

function rawUrl(repo: RepoDescriptor, path: string, ref: string): string {
  return `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${ref}/${path}`
}

function safeJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** Read a Markdown file's YAML frontmatter block, if it has one. */
export function readFrontmatter(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith('---')) return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  try {
    const parsed = parseYaml(text.slice(3, end))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}
