import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const productionDeploySteps = Object.freeze([
  Object.freeze({ id: 'build', command: 'pnpm', args: ['run', 'build'] }),
  Object.freeze({
    id: 'migrate',
    command: 'pnpm',
    args: ['run', 'db:migrate:remote'],
  }),
  Object.freeze({ id: 'deploy', command: 'wrangler', args: ['deploy'] }),
])

export const builtDeploySteps = Object.freeze(productionDeploySteps.slice(1))

export const mysqlDeploySteps = Object.freeze([
  productionDeploySteps[0],
  Object.freeze({
    id: 'migrate-mysql',
    command: 'node',
    args: ['../backend/scripts/migrate-mysql.mjs', '--production'],
  }),
  productionDeploySteps[2],
])

function runCommand({ id, command, args }) {
  console.log(`production deploy: ${id}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const outcome = signal === null ? `exit code ${code}` : `signal ${signal}`
      reject(new Error(`${id} failed with ${outcome}`))
    })
  })
}

export async function runProductionDeploy({
  steps = productionDeploySteps,
  run = runCommand,
} = {}) {
  for (const step of steps) {
    await run(step)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const mysql = /"STORAGE_BACKEND"\s*:\s*"mysql"/.test(config)
    const allSteps = mysql ? mysqlDeploySteps : productionDeploySteps
    const steps = process.argv.includes('--built') ? allSteps.slice(1) : allSteps
    await runProductionDeploy({ steps })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
