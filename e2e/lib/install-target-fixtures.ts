import { sqlString } from './sql.ts'

/**
 * Catalog rows that exercise the dshmarket install-target chain on the site.
 *
 * The shared seed stays one artifact per kind. These exist only in the e2e D1
 * so the install panel can show a verified npm name, a same-repo tarball, and
 * a git spec that must not be guessed from a legal display name.
 */
export const INSTALL_TARGET_FIXTURES = {
  verifiedNpm: 'e2e-verified-npm',
  unpublishedGit: 'e2e-unpublished-git',
  releaseTarball: 'e2e-release-tarball',
} as const

export const INSTALL_TARGET_FIXTURE_COUNT = Object.keys(INSTALL_TARGET_FIXTURES).length

const PIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TARBALL = 'https://github.com/acme/prebuilt/releases/download/v1.0.0/prebuilt-1.0.0.tgz'

function row(input: {
  id: string
  displayName: string
  summary: string
  source: string
  payload: string
  installs: number
}): string {
  return `(
  ${sqlString(input.id)}, 'bundle', ${sqlString(input.displayName)},
  ${sqlString(input.summary)},
  ${sqlString(input.source)}, 'github',
  ${sqlString(input.payload)},
  '["e2e"]', '["other"]', 'MIT', 'acme', 0,
  0, 0, ${input.installs},
  1754006400000, 1754006400000, 1754006400000
)`
}

export function installTargetFixtureSql(): string {
  const artifacts = [
    row({
      id: INSTALL_TARGET_FIXTURES.verifiedNpm,
      displayName: 'dsh-context',
      summary: 'GitHub-indexed, but the packument is this same repository.',
      source: JSON.stringify({
        origin: 'github',
        owner: 'bowenliang123',
        repo: 'dsh-context',
        commit: PIN,
        npm: { packageName: 'dsh-context', latestVersion: '0.38.1' },
      }),
      payload: JSON.stringify({ kind: 'bundle', requiresBuild: true }),
      installs: 3,
    }),
    row({
      id: INSTALL_TARGET_FIXTURES.unpublishedGit,
      displayName: 'dsh-inline-comments',
      summary: 'A legal package name that is not a verified npm binding.',
      source: JSON.stringify({
        origin: 'github',
        owner: 'acme',
        repo: 'dsh-inline-comments',
        commit: PIN,
      }),
      payload: JSON.stringify({ kind: 'bundle', requiresBuild: true }),
      installs: 2,
    }),
    row({
      id: INSTALL_TARGET_FIXTURES.releaseTarball,
      displayName: 'dsh-prebuilt',
      summary: 'Author-supplied Release tarball, no npm package.',
      source: JSON.stringify({
        origin: 'github',
        owner: 'acme',
        repo: 'prebuilt',
        commit: PIN,
        releaseTarball: TARBALL,
      }),
      payload: JSON.stringify({ kind: 'bundle', requiresBuild: true }),
      installs: 1,
    }),
  ]

  const ids = Object.values(INSTALL_TARGET_FIXTURES)
  const categories = ids.map((id) => `(${sqlString(id)}, 'other')`)

  return `
INSERT INTO artifacts (
  id, kind, display_name, summary, source, source_origin, payload,
  keywords, categories, license, author_name, deprecated,
  stars, downloads, installs,
  published_at, updated_at, indexed_at
) VALUES
${artifacts.join(',\n')};

INSERT INTO artifact_search (artifact_id, haystack)
SELECT id, lower(display_name || ' ' || summary) FROM artifacts
WHERE id IN (${ids.map((id) => sqlString(id)).join(', ')});

INSERT INTO artifact_categories (artifact_id, category_id) VALUES
${categories.join(',\n')};

UPDATE artifacts SET popularity = (installs * 3 + stars + downloads / 10.0)
  * (CASE WHEN owner_account_id IS NOT NULL THEN 1.25 ELSE 1 END)
  * (CASE WHEN deprecated THEN 0.1 ELSE 1 END);
`
}

export const RELEASE_TARBALL_SPEC = TARBALL
export const GIT_PIN = PIN
