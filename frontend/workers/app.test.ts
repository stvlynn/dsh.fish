import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HubEnv } from '@dsh-fish/backend/infrastructure/config/env.js'
import type { Container } from '@dsh-fish/backend/infrastructure/container.js'
import { createContainer } from '@dsh-fish/backend/infrastructure/container.js'
import { hubContext } from '@/shared/api/hub-context'
import worker from './app'

const mocks = vi.hoisted(() => ({
  markdown: vi.fn(),
  router: vi.fn(),
  apiFetch: vi.fn(),
  edgeCache: vi.fn(),
  budget: vi.fn(),
}))
vi.mock('@dsh-fish/backend', async (original) => ({
  ...(await original<typeof import('@dsh-fish/backend')>()),
  createApiApp: () => ({ fetch: mocks.apiFetch }),
}))
vi.mock('@dsh-fish/backend/infrastructure/container.js', () => ({
  createContainer: vi.fn(),
}))
vi.mock('@dsh-fish/backend/infrastructure/agents/agents-readme-localization-scheduler.js', () => ({
  AgentsReadmeLocalizationScheduler: class {},
}))
vi.mock('@dsh-fish/backend/infrastructure/agents/readme-i18n-agent.js', () => ({
  ReadmeI18nAgent: class {},
}))
vi.mock('@dsh-fish/backend/infrastructure/catalog-query-admission.js', () => ({
  CatalogQueryAdmission: class {},
}))
vi.mock('react-router', async (original) => ({
  ...(await original<typeof import('react-router')>()),
  createRequestHandler: () => mocks.router,
}))
vi.mock('virtual:react-router/server-build', () => ({}))
vi.mock('@/pages/markdown', () => ({
  maybeMarkdownResponse: mocks.markdown,
  notFoundMarkdownResponse: () => new Response('not found', { status: 404 }),
  shouldServeMarkdownNotFound: () => false,
  supportsMarkdownNegotiation: () => false,
}))
vi.mock('@/shared/api/agent-discovery', () => ({
  withDiscoveryLinks: (response: Response) => response,
}))
vi.mock('./edge-cache', () => ({
  withEdgeCache: mocks.edgeCache,
}))
vi.mock('./catalog-scrape-gate', () => ({
  MYSQL_SEARCH_BUDGET_PER_MINUTE: 120,
  scrapeShedResponse: () => undefined,
  catalogSearchBudgetShed: mocks.budget,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function context() {
  const jobs: Promise<unknown>[] = []
  return {
    waitUntil: (job: Promise<unknown>) => {
      jobs.push(job)
    },
    passThroughOnException: vi.fn(),
    jobs,
  }
}
const env = { CATALOG_SEARCH_PAUSED: 'false' } as HubEnv
function container() {
  return {
    config: { baseUrl: 'https://dsh.fish' },
    dispose: vi.fn(async () => {}),
    useCases: {
      ingestCatalog: { execute: vi.fn(async () => ({})) },
      reclassifyCatalog: { execute: vi.fn(async () => ({})) },
      refreshCatalogFacets: { execute: vi.fn(async () => ({})) },
      backfillReadmeLocalization: { execute: vi.fn(async () => ({})) },
    },
  }
}
function open(value: ReturnType<typeof container>) {
  vi.mocked(createContainer).mockResolvedValue(value as unknown as Container)
}
const fetch = (path: string, bindings = env, ctx = context()) =>
  worker.fetch(new Request('https://dsh.fish' + path) as never, bindings, ctx as never)
const schedule = (cron: string, bindings: HubEnv, ctx: ReturnType<typeof context>) =>
  worker.scheduled({ cron } as never, bindings, ctx as never)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.budget.mockResolvedValue(undefined)
  mocks.edgeCache.mockImplementation((_request, _ctx, handle: () => Promise<Response>) => handle())
  mocks.markdown.mockResolvedValue(null)
  mocks.router.mockResolvedValue(new Response('page'))
})

describe('Worker request container lifecycle', () => {
  it('admits costly MySQL work before the handler and releases after it completes', async () => {
    mocks.budget.mockRejectedValue(new Error('MySQL search must not write the legacy KV counter'))
    const phases: string[] = []
    const stub = {
      fetch: vi.fn(async (url: string) => {
        if (url.endsWith('/acquire')) {
          phases.push('acquire')
          return Response.json({
            token: '12345678-1234-4234-8234-123456789abc',
            expiresAt: Date.now() + 120_000,
          })
        }
        phases.push('release')
        return new Response(null, { status: 204 })
      }),
    }
    const namespace = { idFromName: vi.fn(() => ({})), get: vi.fn(() => stub) }
    mocks.apiFetch.mockImplementation(async () => {
      phases.push('handler')
      return new Response('api')
    })
    const response = await fetch('/api/v1/artifacts?q=python', {
      ...env,
      STORAGE_BACKEND: 'mysql',
      CAT_QUERY_ADMISSION: namespace as unknown as DurableObjectNamespace,
    })
    expect(await response.text()).toBe('api')
    expect(phases).toEqual(['acquire', 'handler', 'release'])
    expect(mocks.budget).not.toHaveBeenCalled()
  })
  it('uses a separate MySQL cache generation while preserving legacy D1 keys', async () => {
    mocks.apiFetch.mockImplementation(async () => new Response('api'))
    await (await fetch('/api/v1/scoring', { ...env, STORAGE_BACKEND: 'mysql' })).text()
    expect(mocks.edgeCache.mock.calls[0]?.[3]).toBe('mysql-v1')
    await (await fetch('/api/v1/scoring', { ...env, STORAGE_BACKEND: 'd1' })).text()
    expect(mocks.edgeCache.mock.calls[1]?.[3]).toBe('')
  })

  it('awaits construction and disposes markdown responses', async () => {
    const opened = deferred<Container>()
    vi.mocked(createContainer).mockReturnValue(opened.promise)
    mocks.markdown.mockResolvedValue(new Response('markdown'))
    const pending = fetch('/a/test-plugin')
    expect(mocks.markdown).not.toHaveBeenCalled()
    const instance = container()
    opened.resolve(instance as unknown as Container)
    const response = await pending
    expect(await response.text()).toBe('markdown')
    expect(instance.dispose).toHaveBeenCalledOnce()
    expect(mocks.router).not.toHaveBeenCalled()
  })
  it('keeps SSR persistence alive until response and loader background work settle', async () => {
    const instance = container()
    open(instance)
    const background = deferred<void>()
    mocks.router.mockImplementation(async (_request, routerContext) => {
      routerContext.get(hubContext).ctx.waitUntil(background.promise)
      return new Response('page')
    })
    const ctx = context()
    const response = await fetch('/a/test-plugin', env, ctx)
    const text = response.text()
    expect(instance.dispose).not.toHaveBeenCalled()
    background.resolve()
    expect(await text).toBe('page')
    await Promise.all(ctx.jobs)
    expect(instance.dispose).toHaveBeenCalledOnce()
  })
  it('disposes when markdown negotiation fails', async () => {
    const instance = container()
    open(instance)
    mocks.markdown.mockRejectedValue(new Error('markdown failed'))
    await expect(fetch('/a/test-plugin')).rejects.toThrow('markdown failed')
    expect(instance.dispose).toHaveBeenCalledOnce()
  })
  it('returns API responses without opening a second SSR container', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('api'))
    expect(await (await fetch('/api/v1/scoring')).text()).toBe('api')
    expect(createContainer).not.toHaveBeenCalled()
  })
  it('makes search pause configurable and gates maintenance before persistence', async () => {
    expect((await fetch('/browse?q=python', {} as HubEnv)).status).toBe(503)
    expect((await fetch('/a/test-plugin', { ...env, CATALOG_WRITES_PAUSED: 'true' })).status).toBe(
      503,
    )
    expect(createContainer).not.toHaveBeenCalled()
    const instance = container()
    open(instance)
    await (await fetch('/browse?q=python', env)).text()
    expect(createContainer).toHaveBeenCalledOnce()
  })
})

describe('Worker cron lifecycle', () => {
  it('keeps cron paused by default and honors write maintenance even when resumed', async () => {
    const ctx = context()
    await schedule('* * * * *', env, ctx)
    await schedule(
      '* * * * *',
      { ...env, CATALOG_CRON_PAUSED: 'false', CATALOG_WRITES_PAUSED: 'true' },
      ctx,
    )
    expect(createContainer).not.toHaveBeenCalled()
    expect(ctx.jobs).toHaveLength(0)
  })
  it('serializes hourly jobs and disposes only after backfill', async () => {
    const instance = container()
    open(instance)
    const ingest = deferred<object>()
    instance.useCases.ingestCatalog.execute.mockReturnValue(ingest.promise)
    const ctx = context()
    await schedule('0 * * * *', { ...env, CATALOG_CRON_PAUSED: 'false' }, ctx)
    expect(instance.useCases.ingestCatalog.execute).toHaveBeenCalledOnce()
    expect(instance.useCases.reclassifyCatalog.execute).not.toHaveBeenCalled()
    expect(instance.dispose).not.toHaveBeenCalled()
    ingest.resolve({})
    await Promise.all(ctx.jobs)
    const order = [
      instance.useCases.ingestCatalog.execute,
      instance.useCases.reclassifyCatalog.execute,
      instance.useCases.refreshCatalogFacets.execute,
      instance.useCases.backfillReadmeLocalization.execute,
      instance.dispose,
    ].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a! - b!))
    expect(instance.dispose).toHaveBeenCalledOnce()
  })
  it('runs only bounded backfill on minutely events and disposes after failure', async () => {
    const instance = container()
    open(instance)
    instance.useCases.backfillReadmeLocalization.execute.mockRejectedValue(
      new Error('backfill failed'),
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = context()
    await schedule('* * * * *', { ...env, CATALOG_CRON_PAUSED: 'false' }, ctx)
    await Promise.all(ctx.jobs)
    expect(instance.useCases.backfillReadmeLocalization.execute).toHaveBeenCalledWith(1, {
      retryStaleFailures: false,
    })
    expect(instance.useCases.ingestCatalog.execute).not.toHaveBeenCalled()
    expect(instance.dispose).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(
      'catalog_scheduled_failed',
      expect.objectContaining({ cron: '* * * * *' }),
    )
    log.mockRestore()
  })
})
