import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lookupNpmBinding } from './npm-binding.js'
import { githubSource, installTargetFor, npmSource } from '../../domain/artifact/source-ref.js'

/**
 * Real registry + isolated pnpm add. Off unless LIVE_INSTALL=1 so `pnpm test`
 * stays offline.
 */

const live = process.env.LIVE_INSTALL === '1'

interface Case {
  readonly id: string
  readonly owner: string
  readonly repo: string
  readonly packageName: string
  readonly expectNpm: boolean
}

const CASES: readonly Case[] = [
  {
    id: 'dsh-context',
    owner: 'bowenliang123',
    repo: 'dsh-context',
    packageName: 'dsh-context',
    expectNpm: true,
  },
  {
    id: 'dsh-better-sidebar',
    owner: 'omdsh-dev',
    repo: 'DSH-better-sidebar',
    packageName: 'dsh-better-sidebar',
    expectNpm: true,
  },
  {
    id: 'superdesign-dsh',
    owner: 'superdesigndev',
    repo: 'superdesign-skill',
    packageName: 'superdesign-dsh',
    expectNpm: false,
  },
  {
    id: 'dsh-harmony-next',
    owner: 'linhay',
    repo: 'harmony-next.skills',
    packageName: 'dsh-harmony-next',
    expectNpm: false,
  },
]

async function liveGithub(id: string): Promise<{ owner: string; repo: string } | undefined> {
  const response = await fetch(`https://dsh.fish/api/v1/artifacts/${id}`)
  if (!response.ok) return undefined
  const body = (await response.json()) as { sourceUrl?: string }
  const match = body.sourceUrl?.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { owner: match[1], repo: match[2] }
}

function pnpmAdd(spec: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-target-'))
  writeFileSync(join(dir, 'package.json'), '{"name":"verify","private":true,"dependencies":{}}\n')
  try {
    execFileSync(
      'pnpm',
      ['add', spec, '--ignore-workspace', '--reporter=append-only', '--config.minimumReleaseAge=0'],
      { cwd: dir, encoding: 'utf8', timeout: 180_000 },
    )
    return true
  } catch {
    return false
  }
}

describe.skipIf(!live)('live install targets', () => {
  it('binds published GitHub plugins to npm and leaves unpublished names on git', async () => {
    for (const seed of CASES) {
      const listed = { ...seed, ...(await liveGithub(seed.id)) }
      const binding = await lookupNpmBinding(listed.packageName, listed.owner, listed.repo)
      const spec = installTargetFor(
        githubSource({
          owner: listed.owner,
          repo: listed.repo,
          commit: 'a'.repeat(40),
          ...(binding === undefined ? {} : { npm: binding }),
        }),
      )

      if (seed.expectNpm) {
        expect(binding, listed.id).toMatchObject({ packageName: listed.packageName })
        expect(spec).toBe(listed.packageName)
        expect(pnpmAdd(spec!), `${listed.id} pnpm add ${spec}`).toBe(true)
      } else {
        expect(binding, listed.id).toBeUndefined()
        expect(spec).toBe(`github:${listed.owner}/${listed.repo}#${'a'.repeat(40)}`)
        expect(pnpmAdd(listed.packageName), `${listed.id} must not install by display name`).toBe(
          false,
        )
      }
    }
  }, 240_000)

  it('pins an npm-origin package to name@version', () => {
    expect(installTargetFor(npmSource('dsh-context', '0.38.1'))).toBe('dsh-context@0.38.1')
  })
})
