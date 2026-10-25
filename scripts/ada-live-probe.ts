#!/usr/bin/env node
/**
 * Bounded live probe of Ada (Fast only). Never run from CI.
 *
 *   LIVE_ADA_PROBE=1 node --experimental-strip-types scripts/ada-live-probe.ts
 *
 * Hard cap: 20 requests. Sequential 8 (2s gap), then concurrency 2 × 8.
 * Aborts on HTTP 429, 403, or 5 consecutive failures.
 *
 * Completing 20 requests does not prove Ada has no limiter.
 */
const ADA_QUERY = 'https://api.devin.ai/ada/query'
const ADA_WS = 'https://api.devin.ai/ada/ws/query/'
const REPO = process.env.ADA_PROBE_REPO ?? 'facebook/react'
const HARD_CAP = 20
const SEQUENTIAL = 8
const PARALLEL = 8
const PARALLEL_CONCURRENCY = 2
const GAP_MS = 2000
const REQUESTED = Number(process.env.ADA_PROBE_COUNT ?? HARD_CAP)
if (!Number.isSafeInteger(REQUESTED) || REQUESTED < 1 || REQUESTED > HARD_CAP)
  throw new Error('ADA_PROBE_COUNT must be between 1 and 20')

interface ProbeResult {
  readonly n: number
  readonly ok: boolean
  readonly status?: number
  readonly ttfbMs?: number
  readonly doneMs?: number
  readonly phase?: 'post' | 'ws'
  readonly retryAfter?: string
  readonly error?: string
}

function requireGate(): void {
  if (process.env.LIVE_ADA_PROBE !== '1') {
    console.error('Refusing to run. Set LIVE_ADA_PROBE=1 to probe Ada (ops only, never CI).')
    process.exit(2)
  }
}

function queryId(n: number): string {
  return `dsh-fish-probe-${n}_${crypto.randomUUID()}`
}

async function oneAsk(n: number): Promise<ProbeResult> {
  const started = Date.now()
  const id = queryId(n)
  const post = await fetch(ADA_QUERY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      mode: 'fast',
      user_query: 'In one short sentence, what is this repository?',
      keywords: [],
      repo_names: [REPO],
      additional_context: '',
      query_id: id,
      use_notes: false,
      generate_summary: false,
      source: 'ada.dsh_fish',
    }),
  })
  const retryAfter = post.headers.get('retry-after') ?? undefined
  if (post.status === 429 || post.status === 403 || post.status >= 500) {
    return {
      n,
      ok: false,
      status: post.status,
      ttfbMs: Date.now() - started,
      phase: 'post',
      ...(retryAfter === undefined ? {} : { retryAfter }),
    }
  }
  if (!post.ok) {
    return {
      n,
      ok: false,
      status: post.status,
      ttfbMs: Date.now() - started,
      phase: 'post',
      error: `POST ${post.status}`,
    }
  }

  const ttfbMs = Date.now() - started
  const wsUrl = ADA_WS.replace('https://', 'wss://') + encodeURIComponent(id)
  try {
    const doneMs = await waitForDone(wsUrl)
    return { n, ok: true, status: post.status, ttfbMs, doneMs }
  } catch (error) {
    return {
      n,
      ok: false,
      status: post.status,
      ttfbMs,
      phase: 'ws',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function waitForDone(url: string): Promise<number> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('websocket timeout'))
    }, 60_000)
    socket.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data)
      try {
        const frame = JSON.parse(raw) as { type?: string; done?: boolean }
        if (frame.type === 'done' || frame.done === true) {
          clearTimeout(timer)
          socket.close()
          resolve(Date.now() - started)
        }
      } catch {
        /* skip malformed */
      }
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('websocket error'))
    })
    socket.addEventListener('close', () => {
      clearTimeout(timer)
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  requireGate()
  const results: ProbeResult[] = []
  let consecutiveFailures = 0
  let aborted: string | undefined

  const run = async (n: number): Promise<boolean> => {
    if (results.length >= REQUESTED) return false
    const result = await oneAsk(n)
    results.push(result)
    console.log(JSON.stringify(result))
    if (result.status === 429 || result.status === 403) {
      aborted = `HTTP ${result.status}`
      return false
    }
    if (!result.ok) {
      consecutiveFailures += 1
      if (consecutiveFailures >= 5) {
        aborted = '5 consecutive failures'
        return false
      }
    } else {
      consecutiveFailures = 0
    }
    return true
  }

  let n = 1
  for (let i = 0; i < SEQUENTIAL && n <= REQUESTED; i += 1, n += 1) {
    const ok = await run(n)
    if (!ok) break
    if (i < SEQUENTIAL - 1) await sleep(GAP_MS)
  }

  if (aborted === undefined) {
    const pending: Promise<void>[] = []
    let inflight = 0
    let index = 0
    const tasks = Array.from(
      { length: Math.min(PARALLEL, REQUESTED - results.length) },
      (_, i) => n + i,
    )
    await new Promise<void>((resolve) => {
      const kick = () => {
        if (aborted !== undefined || index >= tasks.length) {
          if (inflight === 0) resolve()
          return
        }
        while (inflight < PARALLEL_CONCURRENCY && index < tasks.length && aborted === undefined) {
          const current = tasks[index]!
          index += 1
          inflight += 1
          pending.push(
            run(current).then((ok) => {
              if (!ok) {
                /* aborted */
              }
              inflight -= 1
              kick()
            }),
          )
        }
        if (inflight === 0) resolve()
      }
      kick()
    })
    await Promise.all(pending)
  }

  const limiterObserved = results.some(
    (row) => row.status === 429 || row.status === 403 || (row.phase === 'ws' && !row.ok),
  )
  const summary = {
    repo: REPO,
    requests: results.length,
    ok: results.filter((row) => row.ok).length,
    aborted,
    limiterObserved,
    note: limiterObserved
      ? 'Ada showed a limiter or systematic WS failure in this bounded run.'
      : 'None observed. Completing this run does not prove there is no limit.',
    results,
  }
  console.log(JSON.stringify(summary, null, 2))
  if (aborted !== undefined && results.some((row) => row.status === 429 || row.status === 403)) {
    process.exit(0)
  }
}

await main()
