type AdmissionStore = {
  eval(script: string, numberOfKeys: number, ...arguments_: (string | number)[]): Promise<unknown>
}
import { isExpensiveCatalogRequest } from '../workers/catalog-query-admission'

const ACQUIRE = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local updated = tonumber(state[2]) or now
local tokens = math.min(2, (tonumber(state[1]) or 2) + math.max(0, now - updated) / 500)
if tokens < 1 then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
redis.call('HSET', KEYS[1], 'tokens', tokens - 1, 'updated', now)
redis.call('EXPIRE', KEYS[1], 10)
redis.call('SET', KEYS[2], ARGV[1], 'PX', 120000)
return 1`
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`

/** One costly catalog request across replicas; token-specific cleanup is idempotent. */
export async function withNodeAdmission(
  request: Request,
  redis: AdmissionStore,
  handle: () => Promise<Response>,
): Promise<Response> {
  if (!isExpensiveCatalogRequest(request)) return handle()
  const token = crypto.randomUUID()
  const lease = 'hub:catalog:lease'
  // Smooth the former 120/minute allowance instead of spending it in an early burst.
  // Busy requests wait briefly; no database work starts until the lease is theirs.
  let granted: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    granted = await redis.eval(ACQUIRE, 2, 'hub:catalog:tokens:v1', lease, token)
    if (granted !== -1) break
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 40))
  }
  if (granted !== 1)
    return new Response(null, {
      status: 429,
      headers: { 'retry-after': '1', 'cache-control': 'no-store' },
    })
  try {
    return await handle()
  } finally {
    await redis.eval(RELEASE, 1, lease, token)
  }
}
