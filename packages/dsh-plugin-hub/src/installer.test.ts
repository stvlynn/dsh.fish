import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HubClient, InstallPlan, InstallStep } from './hub-client.js'
import { InstallRefused, PlanInstaller, packageNameFromSpec } from './installer.js'
import { listLocked, readLock } from './lockfile.js'

function plan(overrides: Partial<InstallPlan> & { steps: InstallStep[] }): InstallPlan {
  return {
    artifactId: 'example',
    kind: 'skill',
    profile: 'web',
    manualCommands: [],
    warningKeys: [],
    ...overrides,
  }
}

function client(): HubClient {
  return {} as HubClient
}

describe('packageNameFromSpec', () => {
  it('keeps the scope on a versioned npm name', () => {
    expect(packageNameFromSpec('@acme/thing@1.2.3')).toBe('@acme/thing')
    expect(packageNameFromSpec('thing@1.2.3')).toBe('thing')
  })

  it('uses the repo name of a git spec', () => {
    expect(packageNameFromSpec(`github:acme/thing#${'a'.repeat(40)}`)).toBe('thing')
  })
})

describe('PlanInstaller', () => {
  it('writes skill files under $DSH_HOME and records them in the lockfile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'web', {
      home,
      fetchText: async () => '---\nname: notes\ndescription: x\n---\n',
    })

    const outcome = await installer.apply(
      plan({
        steps: [
          {
            type: 'write-file',
            root: 'dsh-home',
            relativePath: 'skills/notes/SKILL.md',
            downloadUrl: 'https://example.test/SKILL.md',
          },
        ],
      }),
      { allowBuildScripts: false, signal: new AbortController().signal },
    )

    expect(outcome.steps[0]).toMatchObject({ applied: true, summary: 'Wrote skills/notes/SKILL.md' })
    expect(await readFile(join(home, 'skills/notes/SKILL.md'), 'utf8')).toContain('name: notes')

    const locked = listLocked(await readLock(home), 'web')
    expect(locked).toHaveLength(1)
    expect(locked[0]?.files).toEqual(['skills/notes/SKILL.md'])
  })

  it('refuses a write that escapes $DSH_HOME', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'web', {
      home,
      fetchText: async () => 'nope',
    })

    await expect(
      installer.apply(
        plan({
          steps: [
            {
              type: 'write-file',
              root: 'dsh-home',
              relativePath: '../outside.md',
              downloadUrl: 'https://example.test/x',
            },
          ],
        }),
        { allowBuildScripts: false, signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: 'PATH_ESCAPE' })
  })

  it('refuses a build-allowance plan until the caller opts in', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'web', { home })

    await expect(
      installer.apply(
        plan({
          kind: 'bundle',
          steps: [
            {
              type: 'add-package',
              profile: 'web',
              spec: 'github:acme/thing',
              requiresBuildAllowance: true,
            },
          ],
        }),
        { allowBuildScripts: false, signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(InstallRefused)
  })

  it('runs dsh plugin add and records the new dependency name', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    await mkdir(join(home, 'profiles/web'), { recursive: true })
    await writeFile(
      join(home, 'profiles/web/package.json'),
      JSON.stringify({ dependencies: { '@deepseek-ai/dsh-base': '1.0.0' } }),
    )

    const calls: string[][] = []
    const installer = new PlanInstaller(client(), 'web', {
      home,
      run: async (_file, args) => {
        calls.push([...args])
        if (args[3] === 'add') {
          await writeFile(
            join(home, 'profiles/web/package.json'),
            JSON.stringify({
              dependencies: {
                '@deepseek-ai/dsh-base': '1.0.0',
                'dsh-hello': '1.2.3',
              },
            }),
          )
        }
        return { stdout: 'ok', stderr: '' }
      },
    })

    await installer.apply(
      plan({
        kind: 'bundle',
        steps: [
          {
            type: 'add-package',
            profile: 'web',
            spec: 'dsh-hello@1.2.3',
            requiresBuildAllowance: false,
          },
        ],
      }),
      { allowBuildScripts: false, signal: new AbortController().signal },
    )

    expect(calls[0]).toEqual(['plugin', '--profile', 'web', 'add', 'dsh-hello@1.2.3'])
    expect(listLocked(await readLock(home), 'web')[0]?.packages).toEqual([
      { spec: 'dsh-hello@1.2.3', name: 'dsh-hello' },
    ])

    const removed = await installer.remove('example', {
      signal: new AbortController().signal,
    })
    expect(removed.steps[0]?.summary).toBe('dsh plugin --profile web remove dsh-hello')
  })

  it('writes into the profile it was constructed with, not the plan default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const calls: string[][] = []
    const installer = new PlanInstaller(client(), 'local-dsh', {
      home,
      run: async (_file, args) => {
        calls.push([...args])
        return { stdout: '', stderr: '' }
      },
    })

    await installer.apply(
      plan({
        kind: 'bundle',
        profile: 'local-dsh',
        steps: [
          {
            type: 'add-package',
            profile: 'local-dsh',
            spec: 'dsh-hello@1.2.3',
            requiresBuildAllowance: false,
          },
        ],
      }),
      { allowBuildScripts: false, signal: new AbortController().signal },
    )

    expect(calls[0]).toEqual(['plugin', '--profile', 'local-dsh', 'add', 'dsh-hello@1.2.3'])
    expect(listLocked(await readLock(home), 'local-dsh')).toHaveLength(1)
  })

  it('names the searched PATH when the launcher is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'local-dsh', {
      home,
      run: async () => {
        throw Object.assign(new Error('spawn dsh ENOENT'), { code: 'ENOENT' })
      },
    })

    const failure = await installer
      .apply(
        plan({
          kind: 'bundle',
          profile: 'local-dsh',
          steps: [
            {
              type: 'add-package',
              profile: 'local-dsh',
              spec: '@dsh-fish/hub',
              requiresBuildAllowance: false,
            },
          ],
        }),
        { allowBuildScripts: false, signal: new AbortController().signal },
      )
      .then(
        () => undefined,
        (error: unknown) => error as InstallRefused,
      )

    expect(failure?.code).toBe('PACKAGE_INSTALL_FAILED')
    expect(failure?.message).toContain('dsh plugin --profile local-dsh add @dsh-fish/hub')
    expect(failure?.message).toContain('is not on PATH')
    expect(failure?.message).toContain(process.env['PATH'] ?? '(PATH unset)')
  })

  it('refuses remove when the lockfile has no matching row', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'web', { home })
    await expect(
      installer.remove('missing', { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'NOT_INSTALLED' })
  })
})

describe('Electron-managed profile', () => {
  // DSH 0.2.x refuses `dsh plugin --profile desktop …` to any process that is
  // not the Desktop carrier. That fence belongs to the *spawned launcher*, so
  // the installer refuses only when spawning is how it would have to work; a
  // host that supplies an in-process manager can install there.
  const desktopPlan = () =>
    plan({
      kind: 'bundle',
      steps: [
        {
          type: 'add-package',
          profile: 'desktop',
          spec: 'dsh-hello@1.2.3',
          requiresBuildAllowance: false,
        },
      ],
    })

  it('refuses to apply without running the package manager', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const calls: string[][] = []
    const installer = new PlanInstaller(client(), 'desktop', {
      home,
      run: async (_file, args) => {
        calls.push([...args])
        return { stdout: '', stderr: '' }
      },
    })

    const failure = await installer
      .apply(desktopPlan(), {
        allowBuildScripts: false,
        signal: new AbortController().signal,
      })
      .then(
        () => undefined,
        (error: unknown) => error as InstallRefused,
      )

    expect(failure?.code).toBe('PROFILE_MANAGED_ELSEWHERE')
    expect(failure?.message).toContain('desktop')
    expect(failure?.message).toContain('Desktop')
    expect(calls).toEqual([])
  })

  it('refuses to remove without running the package manager', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const calls: string[][] = []
    const installer = new PlanInstaller(client(), 'desktop', {
      home,
      run: async (_file, args) => {
        calls.push([...args])
        return { stdout: '', stderr: '' }
      },
    })

    await expect(
      installer.remove('example', { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'PROFILE_MANAGED_ELSEWHERE' })
    expect(calls).toEqual([])
  })

  it('leaves every other profile installable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const calls: string[][] = []
    const installer = new PlanInstaller(client(), 'web', {
      home,
      run: async (_file, args) => {
        calls.push([...args])
        return { stdout: 'ok', stderr: '' }
      },
    })

    await installer.apply(desktopPlan(), {
      allowBuildScripts: false,
      signal: new AbortController().signal,
    })
    expect(calls[0]).toEqual(['plugin', '--profile', 'web', 'add', 'dsh-hello@1.2.3'])
  })
})

describe('in-process package manager', () => {
  const bundlePlan = () =>
    plan({
      kind: 'bundle',
      steps: [
        {
          type: 'add-package',
          profile: 'web',
          spec: 'dsh-hello@1.2.3',
          requiresBuildAllowance: false,
        },
      ],
    })

  it('installs through the host manager instead of spawning the launcher', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    await mkdir(join(home, 'profiles/web'), { recursive: true })
    await writeFile(
      join(home, 'profiles/web/package.json'),
      JSON.stringify({ dependencies: { '@deepseek-ai/dsh-base': '1.0.0' } }),
    )

    const spawned: string[][] = []
    const added: string[] = []
    const installer = new PlanInstaller(client(), 'web', {
      home,
      run: async (_file, args) => {
        spawned.push([...args])
        return { stdout: '', stderr: '' }
      },
      packages: {
        async add(spec) {
          added.push(spec)
          await writeFile(
            join(home, 'profiles/web/package.json'),
            JSON.stringify({
              dependencies: { '@deepseek-ai/dsh-base': '1.0.0', 'dsh-hello': '1.2.3' },
            }),
          )
          return { exitCode: 0, output: 'installed' }
        },
        async remove() {
          return { exitCode: 0, output: 'removed' }
        },
      },
    })

    await installer.apply(bundlePlan(), {
      allowBuildScripts: false,
      signal: new AbortController().signal,
    })

    expect(added).toEqual(['dsh-hello@1.2.3'])
    expect(spawned).toEqual([])
    expect(listLocked(await readLock(home), 'web')[0]?.packages).toEqual([
      { spec: 'dsh-hello@1.2.3', name: 'dsh-hello' },
    ])
  })

  it('manages the desktop profile the launcher refuses to touch', async () => {
    // The whole point of the port: a Desktop-hosted agent must be able to
    // install into the profile the user is actually looking at.
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const added: string[] = []
    const installer = new PlanInstaller(client(), 'desktop', {
      home,
      run: async () => {
        throw new Error('the launcher must not be spawned for a desktop profile')
      },
      packages: {
        async add(spec) {
          added.push(spec)
          return { exitCode: 0, output: 'installed' }
        },
        async remove() {
          return { exitCode: 0, output: 'removed' }
        },
      },
    })

    const outcome = await installer.apply(
      plan({
        kind: 'bundle',
        steps: [
          {
            type: 'add-package',
            profile: 'desktop',
            spec: 'dsh-hello@1.2.3',
            requiresBuildAllowance: false,
          },
        ],
      }),
      { allowBuildScripts: false, signal: new AbortController().signal },
    )

    expect(added).toEqual(['dsh-hello@1.2.3'])
    expect(outcome.steps[0]?.applied).toBe(true)
  })

  it('reports a non-zero package result as a failed install', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'web', {
      home,
      packages: {
        async add() {
          return { exitCode: 1, output: 'ERR_PNPM_FETCH_404' }
        },
        async remove() {
          return { exitCode: 0, output: '' }
        },
      },
    })

    const failure = await installer
      .apply(bundlePlan(), {
        allowBuildScripts: false,
        signal: new AbortController().signal,
      })
      .then(
        () => undefined,
        (error: unknown) => error as InstallRefused,
      )

    expect(failure?.code).toBe('PACKAGE_INSTALL_FAILED')
    expect(failure?.message).toContain('ERR_PNPM_FETCH_404')
  })
})
