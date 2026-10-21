import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { prepareE2eDevVars, seedLocalCatalog } from './lib/seed-local-catalog.ts'
import { KITCHEN_SINK_ARTIFACT_ID } from './lib/kitchen-sink-readme.ts'
import { E2E_ORIGIN, E2E_PORT as port } from './lib/origin.ts'
import { prepareE2eWorkerConfig } from './lib/worker-config.ts'

const root = process.cwd()
const frontend = resolve(root, 'frontend')
const origin = E2E_ORIGIN

void main()

/**
 * Dev server for the mobile markdown e2e suite.
 *
 * Vite must boot before D1 is seeded: the Cloudflare plugin creates the local
 * Durable Object on first start, and a wrangler migrate run before that writes
 * to a file Vite then replaces with an empty one.
 */
async function main(): Promise<void> {
  prepareE2eDevVars(root)
  const workerConfig = prepareE2eWorkerConfig(root)
  const child = spawn('pnpm', ['exec', 'react-router', 'dev', '--port', port, '--strictPort'], {
    cwd: frontend,
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: '1',
      ARTIFACT_ASK_ENABLED: 'true',
      DSH_E2E_WORKER_CONFIG: workerConfig,
    },
  })

  function shutdown(signal: NodeJS.Signals): void {
    child.kill(signal)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  child.on('exit', (code, signal) => {
    if (signal !== null) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })

  try {
    await waitFor(`${origin}/api/health`)
    seedLocalCatalog(root)
    await waitFor(`${origin}/a/${KITCHEN_SINK_ARTIFACT_ID}`)
    console.log(`e2e: plugin page ready at ${origin}/a/${KITCHEN_SINK_ARTIFACT_ID}`)
    await new Promise<void>(() => {
      /* stay alive until Playwright stops the process */
    })
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 120_000
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      last = `${response.status} ${response.statusText}`
    } catch (error) {
      last = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`e2e: timed out waiting for ${url} (${String(last)})`)
}
