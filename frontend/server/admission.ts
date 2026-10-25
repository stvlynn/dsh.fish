type AdmissionStore = {
  eval(script: string, numberOfKeys: number, ...arguments_: (string | number)[]): Promise<unknown>
}
import { isExpensiveCatalogRequest } from '../workers/catalog-query-admission'

const ACQUIRE = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= 120 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'PX', 120000)
local next = redis.call('INCR', KEYS[1])
if next == 1 then redis.call('EXPIRE', KEYS[1], 120) end
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
  const granted = await redis.eval(
    ACQUIRE,
    2,
    `hub:catalog:budget:${Math.floor(Date.now() / 60_000)}`,
    lease,
    token,
  )
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
