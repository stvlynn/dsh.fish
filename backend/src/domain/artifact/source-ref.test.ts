import { describe, expect, it } from 'vitest'
import { githubSource, npmSource, packageSpec } from './source-ref.js'

describe('packageSpec', () => {
  it('pins an npm package to its latest version', () => {
    expect(packageSpec(npmSource('dsh-example', '1.2.3'))).toBe('dsh-example@1.2.3')
  })

  it('emits a git host spec for a repository root', () => {
    expect(packageSpec(githubSource({ owner: 'acme', repo: 'thing' }))).toBe(
      'github:acme/thing',
    )
  })

  it('pins a commit when the registry knows one', () => {
    const commit = 'a'.repeat(40)
    expect(packageSpec(githubSource({ owner: 'acme', repo: 'thing', commit }))).toBe(
      `github:acme/thing#${commit}`,
    )
  })

  it('selects a subdirectory package the way pnpm git installs require', () => {
    expect(
      packageSpec(
        githubSource({ owner: 'stvlynn', repo: 'dsh.fish', path: 'packages/dsh-plugin-hub' }),
      ),
    ).toBe('github:stvlynn/dsh.fish#path:packages/dsh-plugin-hub')
  })

  it('combines a pinned commit with a subdirectory selector', () => {
    const commit = 'b'.repeat(40)
    expect(
      packageSpec(
        githubSource({
          owner: 'stvlynn',
          repo: 'dsh.fish',
          path: 'packages/dsh-plugin-hub',
          commit,
        }),
      ),
    ).toBe(`github:stvlynn/dsh.fish#${commit}&path:packages/dsh-plugin-hub`)
  })
})
