import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiApp, createInvocationContext, withContainerLifecycle } from './app.js'
import { createContainer } from '../../infrastructure/container.js'
import { readRequestSession } from '../../infrastructure/auth/request-session.js'
import type { Container } from '../../infrastructure/container.js'
import type { HubEnv } from '../../infrastructure/config/env.js'

vi.mock('../../infrastructure/container.js', () => ({
  createContainer: vi.fn(),
}))
vi.mock('../../infrastructure/auth/request-session.js', () => ({
  readRequestSession: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function execution() {
  const jobs: Promise<unknown>[] = []
  const context = createInvocationContext({
    waitUntil: (job: Promise<unknown>) => {
      jobs.push(job)
    },
    passThroughOnException: vi.fn(),
  })
  return { context, jobs, settle: () => Promise.allSettled(jobs) }
}
const env = { CATALOG_SEARCH_PAUSED: 'false' } as HubEnv
const container = () =>
  ({
    dispose: vi.fn(async () => {}),
    config: { adminEmails: [] },
    auth: { handler: vi.fn(async () => new Response('auth')) },
    useCases: { describeScoring: { execute: () => ({ score: 42 }) } },
  }) as unknown as Container
const app = () => createApiApp({ readmeLocalization: () => ({ schedule: async () => {} }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readRequestSession).mockResolvedValue(undefined)
})

describe('API async container boundary', () => {
  it('awaits construction before resolving the actor and disposes the response', async () => {
    const opened = deferred<Container>()
    vi.mocked(createContainer).mockReturnValue(opened.promise)
    const response = app().fetch(new Request('https://dsh.fish/api/v1/scoring'), env)
    expect(readRequestSession).not.toHaveBeenCalled()
    const instance = container()
    opened.resolve(instance)
    await expect((await response).json()).resolves.toEqual({ score: 42 })
    expect(instance.dispose).toHaveBeenCalledOnce()
  })
  it('disposes after an actor-resolution failure', async () => {
    const instance = container()
    vi.mocked(createContainer).mockResolvedValue(instance)
    vi.mocked(readRequestSession).mockRejectedValue(new Error('session failed'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await app().fetch(new Request('https://dsh.fish/api/v1/scoring'), env)).status).toBe(
      500,
    )
    expect(instance.dispose).toHaveBeenCalledOnce()
    log.mockRestore()
  })
  it('disposes HEAD responses despite Hono discarding their bodies', async () => {
    const instance = container()
    vi.mocked(createContainer).mockResolvedValue(instance)
    const response = await app().fetch(
      new Request('https://dsh.fish/api/v1/scoring', { method: 'HEAD' }),
      env,
    )
    expect(response.body).toBeNull()
    expect(instance.dispose).toHaveBeenCalledOnce()
  })
  it('gates cutover requests before opening persistence but keeps health alive', async () => {
    const paused = { ...env, CATALOG_WRITES_PAUSED: 'true' }
    for (const path of [
      '/api/auth/callback/github',
      '/api/v1/artifacts/foo/install-plan?record=true',
      '/api/v1/scoring',
    ]) {
      expect((await app().fetch(new Request('https://dsh.fish' + path), paused)).status).toBe(503)
    }
    expect((await app().fetch(new Request('https://dsh.fish/api/health'), paused)).status).toBe(200)
    expect(createContainer).not.toHaveBeenCalled()
  })
})

describe('response and background connection lifetime', () => {
  it('keeps SSE alive until consumption finishes', async () => {
    const { context, settle } = execution()
    const dispose = vi.fn(async () => {})
    let source!: ReadableStreamDefaultController<Uint8Array>
    const response = await withContainerLifecycle(
      { dispose },
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      context,
    )
    source.enqueue(new TextEncoder().encode('event: token\n\n'))
    const reader = response.body!.getReader()
    await reader.read()
    expect(dispose).not.toHaveBeenCalled()
    source.close()
    await reader.read()
    await settle()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('cancels the upstream body and closes once', async () => {
    const { context, settle } = execution()
    const dispose = vi.fn(async () => {})
    const cancel = vi.fn()
    const response = await withContainerLifecycle(
      { dispose },
      async () => new Response(new ReadableStream({ cancel })),
      context,
    )
    await response.body!.cancel('client disconnected')
    await settle()
    expect(cancel).toHaveBeenCalledWith('client disconnected')
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('closes after a response stream errors', async () => {
    const { context, settle } = execution()
    const dispose = vi.fn(async () => {})
    const response = await withContainerLifecycle(
      { dispose },
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('upstream failed'))
            },
          }),
        ),
      context,
    )
    await expect(response.text()).rejects.toThrow('upstream failed')
    await settle()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('waits for background rejection and work registered by another background job', async () => {
    const { context, settle } = execution()
    const first = deferred<void>(),
      second = deferred<void>()
    const dispose = vi.fn(async () => {})
    const task = first.promise.then(() => {
      context.waitUntil(second.promise)
    })
    context.waitUntil(task)
    const response = await withContainerLifecycle(
      { dispose },
      async () => new Response(null, { status: 204 }),
      context,
    )
    expect(response.status).toBe(204)
    expect(dispose).not.toHaveBeenCalled()
    first.resolve()
    await task
    expect(dispose).not.toHaveBeenCalled()
    second.reject(new Error('background failed'))
    await settle()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('keeps each concurrent invocation isolated', async () => {
    const a = execution(),
      b = execution()
    const block = deferred<void>()
    a.context.waitUntil(block.promise)
    const disposeA = vi.fn(async () => {}),
      disposeB = vi.fn(async () => {})
    await withContainerLifecycle({ dispose: disposeA }, async () => new Response(null), a.context)
    await withContainerLifecycle({ dispose: disposeB }, async () => new Response(null), b.context)
    await b.settle()
    expect(disposeA).not.toHaveBeenCalled()
    expect(disposeB).toHaveBeenCalledOnce()
    block.resolve()
    await a.settle()
    expect(disposeA).toHaveBeenCalledOnce()
  })
})
