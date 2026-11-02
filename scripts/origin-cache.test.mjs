import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execute = promisify(execFile)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Opt-in Docker test: use the production nginx image and configuration. */
test('origin cache isolates credentials and coalesces misses', { timeout: 120_000 }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-origin-cache-'))
  const container = `dsh-origin-cache-test-${randomUUID()}`
  const states = new Map()
  const counts = new Map()
  let address = 0
  let created = false
  let origin

  const upstream = http.createServer(async (req, res) => {
    const key = new URL(req.url, 'http://upstream').pathname
    counts.set(key, (counts.get(key) ?? 0) + 1)
    const state = states.get(key) ?? { status: 200, version: 'initial' }
    if (state.delay) await pause(state.delay)
    const status = state.status ?? 200
    const markdown = req.headers.accept?.includes('text/markdown')
    const credentialed = req.headers.cookie || req.headers.authorization
    res.writeHead(status, {
      'content-type': key === '/api/v1/artifacts' ? 'application/json' : markdown ? 'text/markdown' : 'text/html',
      'cache-control': status === 200 && !state.noStore
        ? `public, max-age=1, stale-while-revalidate=${state.window ?? 1}, stale-if-error=${state.window ?? 2}`
        : 'no-store',
      vary: 'Accept',
      ...(state.cookie ? { 'set-cookie': 'test=value; HttpOnly' } : {}),
    })
    const body = `${credentialed ? 'private:' : ''}${markdown ? 'markdown' : 'html'}:${state.version ?? 'initial'}`
    res.end(key === '/api/v1/artifacts' ? JSON.stringify({ items: [], version: state.version ?? 'initial' }) : body)
  })

  try {
    upstream.listen(0, '0.0.0.0')
    await once(upstream, 'listening')
    const port = upstream.address().port
    const source = await readFile(new URL('../deploy/docker/nginx.conf', import.meta.url), 'utf8')
    // Only transport/trusted proxy differs: the fixture is on the Docker host,
    // and simulated client addresses stand in for Cloudflare via Caddy.
    const configuration = source
      .replace('server app:3000 resolve;', `server host.docker.internal:${port};`)
      .replace('set_real_ip_from 172.23.0.0/16;', 'set_real_ip_from 0.0.0.0/0;')
    assert.notEqual(configuration, source)
    await writeFile(join(temporary, 'nginx.conf'), configuration)
    await execute('docker', [
      'create', '--pull=never', '--name', container,
      '--add-host', 'host.docker.internal:host-gateway',
      '-p', '127.0.0.1::8080',
      'nginx:1.28-alpine',
    ])
    created = true
    // docker cp works with remote engines too; binding a host's temp directory
    // would depend on which directories Docker Desktop/Colima shares.
    await execute('docker', ['cp', join(temporary, 'nginx.conf'), `${container}:/etc/nginx/nginx.conf`])
    await execute('docker', ['start', container])
    await execute('docker', ['exec', container, 'nginx', '-t'])
    const { stdout } = await execute('docker', ['port', container, '8080/tcp'])
    origin = `http://${stdout.trim()}`

    async function request(path, headers = {}) {
      const started = performance.now()
      const response = await fetch(origin + path, {
        headers: { accept: 'text/html', 'cf-connecting-ip': `198.18.${address >> 8}.${address++ & 255}`, ...headers },
        signal: AbortSignal.timeout(10_000),
      })
      return {
        status: response.status,
        cache: response.headers.get('x-origin-cache'),
        body: await response.text(),
        elapsed: performance.now() - started,
      }
    }

    await t.test('one cold URL sends only one concurrent request upstream', async () => {
      states.set('/coalesce', { delay: 150, version: 'once' })
      const results = await Promise.all(Array.from({ length: 8 }, () => request('/coalesce')))
      assert.ok(results.every((result) => result.status === 200 && result.body === 'html:once'))
      assert.equal(counts.get('/coalesce'), 1)
    })

    await t.test('expired cached responses survive a 429 refresh and then recover', async () => {
      states.set('/stale', { version: 'old', window: 10 })
      assert.equal((await request('/stale')).body, 'html:old')
      assert.equal((await request('/stale')).cache, 'HIT')
      await pause(2_100)
      states.set('/stale', { status: 429, delay: 200, version: 'rejected' })
      const stale = await request('/stale')
      assert.equal(stale.status, 200)
      assert.equal(stale.body, 'html:old')
      assert.ok(['STALE', 'UPDATING'].includes(stale.cache))
      await pause(300)
      states.set('/stale', { status: 503, version: 'unavailable' })
      assert.equal((await request('/stale')).body, 'html:old')
      await pause(100)
      states.set('/stale', { version: 'fresh' })
      await request('/stale')
      await pause(200)
      const recovered = await request('/stale')
      assert.equal(recovered.body, 'html:fresh')
      assert.equal(recovered.cache, 'HIT')
    })

    await t.test('stale data is not served beyond its bounded error window', async () => {
      await request('/bounded')
      states.set('/bounded', { status: 429 })
      await pause(1_100)
      assert.equal((await request('/bounded')).status, 200)
      // Keep accessing the object; active reads must not extend the stale
      // allowance the way they extend the cache's idle-eviction timer.
      for (let index = 0; index < 10; index += 1) {
        await pause(350)
        await request('/bounded')
      }
      assert.equal((await request('/bounded')).status, 429)
    })

    await t.test('a later 404 cannot be hidden indefinitely by a cached 200', async () => {
      await request('/removed')
      states.set('/removed', { status: 404 })
      // nginx may use stale-if-error for this upstream status too. The explicit
      // bound, not idle eviction, ensures that removed content stops resurfacing.
      await pause(4_100)
      assert.equal((await request('/removed')).status, 404)
    })

    await t.test('warm responses later marked no-store or Set-Cookie stop resurfacing', async () => {
      for (const [path, state] of [['/privacy-change', { noStore: true }], ['/cookie-change', { cookie: true }]]) {
        await request(path)
        states.set(path, { ...state, version: 'new-policy' })
      }
      await pause(4_100)
      for (const path of ['/privacy-change', '/cookie-change']) {
        assert.equal((await request(path)).body, 'html:new-policy')
        const before = counts.get(path)
        await request(path)
        assert.equal(counts.get(path), before + 1)
      }
    })

    await t.test('public catalog JSON caches but other API and no-store data routes do not', async () => {
      await request('/api/v1/artifacts?q=git')
      assert.equal((await request('/api/v1/artifacts?q=git')).cache, 'HIT')
      assert.equal(counts.get('/api/v1/artifacts'), 1)
      for (const path of ['/api/auth/get-session', '/api/stream']) {
        await request(path)
        await request(path)
        assert.equal(counts.get(path), 2)
      }
      states.set('/browse.data', { noStore: true })
      await request('/browse.data?q=git')
      await request('/browse.data?q=git')
      assert.equal(counts.get('/browse.data'), 2)
    })

    await t.test('a never-cached failure is not stored or disguised as success', async () => {
      states.set('/cold-failure', { status: 429 })
      assert.equal((await request('/cold-failure')).status, 429)
      assert.equal((await request('/cold-failure')).status, 429)
      assert.equal(counts.get('/cold-failure'), 2)
    })

    await t.test('cookie and authorization requests bypass anonymous cached bodies', async () => {
      await request('/credentials')
      assert.equal((await request('/credentials')).cache, 'HIT')
      for (const headers of [{ cookie: 'session=value' }, { authorization: 'Bearer fixture' }]) {
        const result = await request('/credentials', headers)
        assert.equal(result.cache, 'BYPASS')
        assert.equal(result.body, 'private:html:initial')
      }
      assert.equal((await request('/credentials')).body, 'html:initial')
    })

    await t.test('HTML and Markdown have separate cache entries', async () => {
      assert.equal((await request('/formats')).body, 'html:initial')
      assert.equal((await request('/formats', { accept: 'text/markdown' })).body, 'markdown:initial')
      assert.equal((await request('/formats')).cache, 'HIT')
      assert.equal((await request('/formats', { accept: 'text/markdown' })).cache, 'HIT')
      assert.equal(counts.get('/formats'), 2)
    })

    await t.test('no-store and Set-Cookie responses never populate the cache', async () => {
      for (const [path, state] of [['/no-store', { noStore: true }], ['/set-cookie', { cookie: true }]]) {
        states.set(path, state)
        await request(path)
        await request(path)
        assert.equal(counts.get(path), 2)
      }
    })
  } finally {
    if (created && counts.size === 0) {
      const { stdout, stderr } = await execute('docker', ['logs', container])
      console.error(stdout + stderr)
    }
    if (created) await execute('docker', ['rm', '-f', container])
    upstream.closeAllConnections()
    await new Promise((resolve) => upstream.close(resolve))
    const resolved = await realpath(temporary)
    assert.ok(basename(resolved).startsWith('dsh-origin-cache-'), 'refuse unexpected cleanup target')
    assert.equal(await realpath(tmpdir()), await realpath(join(resolved, '..')))
    await rm(resolved, { recursive: true })
  }
})
