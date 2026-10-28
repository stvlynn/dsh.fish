/**
 * The admission Lua script against a real Redis.
 *
 * Opt-in: set `ADMISSION_TEST_REDIS_URL` to a throwaway instance on loopback,
 * e.g. `redis://127.0.0.1:56379` from `docker run redis:7.4-alpine` — the
 * image production runs. The mocked lifecycle tests cannot show that the script
 * refills from Redis time, keeps the classes apart, lends only one way, and
 * holds a single slot; only the server that runs it can.
 *
 * The suite flushes the database it connects to, so it refuses any host that is
 * not loopback.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Redis } from '@dsh-fish/backend/infrastructure/node/redis-client.js'
import { ADMISSION_CAPACITY, withNodeAdmission } from './admission'

const url = process.env.ADMISSION_TEST_REDIS_URL
const suite = url === undefined ? describe.skip : describe

const NAVIGATE = { 'sec-fetch-mode': 'navigate' }
const FETCH = { 'sec-fetch-mode': 'cors' }

function search(headers: Record<string, string>, q = 'git'): Request {
  return new Request(`https://dsh.fish/browse?q=${q}`, { headers })
}

const ok = async () => new Response('results')

suite('catalog admission on real Redis', () => {
  let redis: Redis

  beforeAll(async () => {
    const target = new URL(url!)
    if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
      throw new Error('ADMISSION_TEST_REDIS_URL must point at a loopback throwaway instance')
    }
    redis = new Redis({ host: target.hostname, port: Number(target.port || 6379), lazyConnect: true })
    await redis.connect()
  })

  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('grants a burst, then refuses until Redis time refills the bucket', async () => {
    const { burst } = ADMISSION_CAPACITY.document
    const statuses: number[] = []
    for (let index = 0; index <= burst; index += 1) {
      statuses.push((await withNodeAdmission(search(NAVIGATE), redis, ok)).status)
    }
    expect(statuses).toEqual([...Array(burst).fill(200), 429])

    await new Promise((resolve) => setTimeout(resolve, 1_050))
    expect((await withNodeAdmission(search(NAVIGATE), redis, ok)).status).toBe(200)
  })

  it('keeps an exhausted document bucket from refusing an interactive reader', async () => {
    // The production failure, reduced: a crawl drains the page-load share…
    for (let index = 0; index < 10; index += 1) await withNodeAdmission(search(NAVIGATE), redis, ok)
    expect((await withNodeAdmission(search(NAVIGATE), redis, ok)).status).toBe(429)

    // …and a person on a loaded page is still served from their own reserve.
    expect((await withNodeAdmission(search(FETCH), redis, ok)).status).toBe(200)
  })

  it('lets interactive borrow idle document capacity, but never the reverse', async () => {
    const interactive = ADMISSION_CAPACITY.interactive.burst
    const document = ADMISSION_CAPACITY.document.burst

    const served: number[] = []
    for (let index = 0; index < interactive + document + 1; index += 1) {
      served.push((await withNodeAdmission(search(FETCH), redis, ok)).status)
    }
    // Own reserve, then the idle document share, then nothing.
    expect(served).toEqual([...Array(interactive + document).fill(200), 429])

    await redis.flushdb()
    for (let index = 0; index < document; index += 1) await withNodeAdmission(search(NAVIGATE), redis, ok)
    expect((await withNodeAdmission(search(NAVIGATE), redis, ok)).status).toBe(429)
    // The interactive bucket is untouched by the page loads above.
    const tokens = await redis.hget('hub:catalog:tokens:v2:interactive', 'tokens')
    expect(tokens).toBeNull()
  })

  it('runs at most one catalog query at a time', async () => {
    let running = 0
    let peak = 0
    const slow = async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 60))
      running -= 1
      return new Response('results')
    }
    const results = await Promise.all([
      withNodeAdmission(search(FETCH, 'a'), redis, slow),
      withNodeAdmission(search(FETCH, 'b'), redis, slow),
      withNodeAdmission(search(NAVIGATE, 'c'), redis, slow),
    ])
    expect(peak).toBe(1)
    // A busy slot is waited for (up to 160 ms), so a 60 ms query lets the next run.
    expect(results.filter((response) => response.status === 200).length).toBeGreaterThanOrEqual(2)
    expect(await redis.exists('hub:catalog:lease')).toBe(0)
  })

  it('releases the slot when the handler throws', async () => {
    await expect(
      withNodeAdmission(search(FETCH), redis, async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')
    expect(await redis.exists('hub:catalog:lease')).toBe(0)
  })

  it('never lets one owner release another owner\u2019s slot', async () => {
    await redis.set('hub:catalog:lease', 'someone-else', 'PX', 5_000)
    const response = await withNodeAdmission(search(FETCH), redis, ok)
    expect(response.status).toBe(429)
    expect(await redis.get('hub:catalog:lease')).toBe('someone-else')
  })

  it('spends no capacity on an over-bound union', async () => {
    const overBound = new Request(
      'https://dsh.fish/browse?category=ui&category=usage&category=theme&category=model',
      { headers: NAVIGATE },
    )
    for (let index = 0; index < 50; index += 1) {
      await withNodeAdmission(overBound, redis, async () => new Response(null, { status: 404 }))
    }
    expect(await redis.keys('hub:catalog:*')).toEqual([])
    expect((await withNodeAdmission(search(NAVIGATE), redis, ok)).status).toBe(200)
  })
})
