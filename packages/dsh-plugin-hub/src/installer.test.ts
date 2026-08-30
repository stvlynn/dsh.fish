import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HubClient, InstallPlan, InstallStep } from './hub-client.js'
import {
  InstallRefused,
  PlanInstaller,
  ndjsonError,
  packageNameFromSpec,
  pluginMutationArgs,
} from './installer.js'
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

describe('pluginMutationArgs', () => {
  it('adds --reporter=ndjson on add, and -w only at a workspace root', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const plain = join(home, 'plain')
    const workspace = join(home, 'workspace')
    await mkdir(plain, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n')

    expect(pluginMutationArgs('web', 'add', 'dsh-context', plain)).toEqual([
      'plugin',
      '--profile',
      'web',
      'add',
      'dsh-context',
      '--reporter=ndjson',
    ])
    expect(pluginMutationArgs('local-dsh', 'add', 'dsh-context', workspace)).toEqual([
      'plugin',
      '--profile',
      'local-dsh',
      'add',
      '-w',
      'dsh-context',
      '--reporter=ndjson',
    ])
    expect(pluginMutationArgs('local-dsh', 'remove', 'dsh-context', workspace)).toEqual([
      'plugin',
      '--profile',
      'local-dsh',
      'remove',
      '-w',
      'dsh-context',
    ])
  })
})

describe('ndjsonError', () => {
  it('picks the last pnpm diagnostic out of a progress stream', () => {
    const stdout = [
      '{"name":"pnpm:fetching-progress","downloaded":12}',
      '{"err":{"code":"ERR_PNPM_ADDING_TO_ROOT"},"message":"ERR_PNPM_ADDING_TO_ROOT  Cannot install in a workspace root without -w"}',
    ].join('\n')
    expect(ndjsonError(stdout)).toContain('ERR_PNPM_ADDING_TO_ROOT')
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

    expect(calls[0]).toEqual([
      'plugin',
      '--profile',
      'web',
      'add',
      'dsh-hello@1.2.3',
      '--reporter=ndjson',
    ])
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

    expect(calls[0]).toEqual([
      'plugin',
      '--profile',
      'local-dsh',
      'add',
      'dsh-hello@1.2.3',
      '--reporter=ndjson',
    ])
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
    expect(failure?.message).toContain(
      'dsh plugin --profile local-dsh add @dsh-fish/hub --reporter=ndjson',
    )
    expect(failure?.message).toContain('is not on PATH')
    expect(failure?.message).toContain(process.env['PATH'] ?? '(PATH unset)')
  })

  it('injects -w on a workspace profile and surfaces the ndjson error', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    await mkdir(join(home, 'profiles/local-dsh'), { recursive: true })
    await writeFile(join(home, 'profiles/local-dsh/pnpm-workspace.yaml'), 'packages: []\n')

    const calls: string[][] = []
    const installer = new PlanInstaller(client(), 'local-dsh', {
      home,
      run: async (_file, args) => {
        calls.push([...args])
        throw Object.assign(new Error('dsh: pnpm failed in profile directory'), {
          stdout:
            '{"err":{"code":"ERR_PNPM_ADDING_TO_ROOT"},"message":"ERR_PNPM_ADDING_TO_ROOT  Cannot install"}',
          stderr: 'dsh: pnpm failed in profile directory',
        })
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
              spec: 'dsh-context',
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

    expect(calls[0]).toEqual([
      'plugin',
      '--profile',
      'local-dsh',
      'add',
      '-w',
      'dsh-context',
      '--reporter=ndjson',
    ])
    expect(failure?.code).toBe('PACKAGE_INSTALL_FAILED')
    expect(failure?.message).toContain('ERR_PNPM_ADDING_TO_ROOT')
    expect(failure?.message).not.toContain('dsh: pnpm failed in profile directory')
  })

  it('refuses remove when the lockfile has no matching row', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-install-'))
    const installer = new PlanInstaller(client(), 'web', { home })
    await expect(
      installer.remove('missing', { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'NOT_INSTALLED' })
  })
})
