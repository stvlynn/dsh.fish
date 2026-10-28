import { admissionDecision, type AdmissionClass } from './admission-class'

type AdmissionStore = {
  eval(script: string, numberOfKeys: number, ...arguments_: (string | number)[]): Promise<unknown>
}

/**
 * Capacity for costly catalog queries, per class.
 *
 * The total is the same two queries per second the single bucket allowed — the
 * one-core database's measured budget is unchanged. What changes is who may
 * spend it. Production showed the failure of one shared bucket precisely: a
 * crawl of document loads drained it, and a person's search was refused nine
 * times in ten. Practice for this is well established — reserve a share of
 * capacity for the traffic that must keep working, and let only that class
 * borrow the rest (Stripe's load shedder, Netflix's partitioned limits, AWS's
 * guidance on fairness in multi-tenant systems).
 *
 * - `interactive` owns half the rate and may also spend `document` tokens, so a
 *   quiet crawl never leaves readers waiting on their own reserve.
 * - `document` owns the other half and can never touch `interactive`'s.
 */
export const ADMISSION_CAPACITY = Object.freeze({
  interactive: { perSecond: 1, burst: 2 },
  document: { perSecond: 1, burst: 2 },
} as const satisfies Record<AdmissionClass, { perSecond: number; burst: number }>)

/** How long a holder may keep the single query slot before it is presumed dead. */
export const LEASE_MS = 120_000

/** Lease waits: a busy slot clears within a typical query (p50 ≈ 60 ms). */
const WAIT_ATTEMPTS = 5
const WAIT_STEP_MS = 40

/**
 * Atomically: refill both buckets from Redis time, pick a bucket the class may
 * spend, and take the one global query slot.
 *
 * KEYS: own bucket, borrowable bucket ("" when none), slot.
 * ARGV: token, own rate/s, own burst, borrow rate/s, borrow burst, lease ms.
 * Returns 1 granted, 0 no tokens, -1 slot busy.
 *
 * One slot is kept on purpose: the database has one core, and two concurrent
 * catalog scans are slower than two sequential ones. Fairness is decided by the
 * buckets, concurrency by the slot.
 */
const ACQUIRE = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local function level(key, rate, burst)
  local state = redis.call('HMGET', key, 'tokens', 'updated')
  local updated = tonumber(state[2]) or now
  return math.min(burst, (tonumber(state[1]) or burst) + math.max(0, now - updated) * rate / 1000)
end
local own = level(KEYS[1], tonumber(ARGV[2]), tonumber(ARGV[3]))
local spend = nil
if own >= 1 then
  spend = { KEYS[1], own, tonumber(ARGV[3]) }
elseif KEYS[2] ~= '' then
  local borrowed = level(KEYS[2], tonumber(ARGV[4]), tonumber(ARGV[5]))
  if borrowed >= 1 then spend = { KEYS[2], borrowed, tonumber(ARGV[5]) } end
end
if spend == nil then return 0 end
if redis.call('EXISTS', KEYS[3]) == 1 then return -1 end
redis.call('HSET', spend[1], 'tokens', spend[2] - 1, 'updated', now)
redis.call('EXPIRE', spend[1], 10)
redis.call('SET', KEYS[3], ARGV[1], 'PX', tonumber(ARGV[6]))
return 1`

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`

/** Response header naming why admission refused a request; logged, not cached. */
export const ADMISSION_HEADER = 'x-catalog-admission'

const SLOT_KEY = 'hub:catalog:lease'
const bucketKey = (admissionClass: AdmissionClass) => `hub:catalog:tokens:v2:${admissionClass}`

/**
 * Run `handle` only once the request holds capacity of its class and the one
 * catalog query slot. Cheap requests, and over-bound facet unions that the
 * handler refuses without a query, pass straight through.
 */
export async function withNodeAdmission(
  request: Request,
  redis: AdmissionStore,
  handle: () => Promise<Response>,
): Promise<Response> {
  const decision = admissionDecision(request)
  if (decision.kind === 'bypass') return handle()

  const own = ADMISSION_CAPACITY[decision.class]
  const borrow = decision.class === 'interactive' ? ADMISSION_CAPACITY.document : undefined
  const token = crypto.randomUUID()
  let granted: unknown
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    granted = await redis.eval(
      ACQUIRE,
      3,
      bucketKey(decision.class),
      borrow === undefined ? '' : bucketKey('document'),
      SLOT_KEY,
      token,
      own.perSecond,
      own.burst,
      borrow?.perSecond ?? 0,
      borrow?.burst ?? 0,
      LEASE_MS,
    )
    if (granted !== -1) break
    if (attempt < WAIT_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS))
  }
  if (granted !== 1) {
    // The class and reason ride on the response, and the request log line
    // reports them. A separate log event per refusal would double the log
    // volume exactly when a crawl is producing thousands of refusals a minute.
    return new Response(null, {
      status: 429,
      headers: {
        'retry-after': '1',
        'cache-control': 'no-store',
        [ADMISSION_HEADER]: `${decision.class};${granted === -1 ? 'slot-busy' : 'no-tokens'}`,
      },
    })
  }
  try {
    return await handle()
  } finally {
    await redis.eval(RELEASE, 1, SLOT_KEY, token)
  }
}
