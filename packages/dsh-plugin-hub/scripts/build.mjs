/**
 * Host ESM + CJS client wrapped for the DSH module loader.
 *
 * `tsdown` emits the Node halves as ESM. The browser half has to be CJS inside
 * `window.__ModuleLoader__.load`, which is what the harness client actually
 * executes — a published ESM `client.js` loads without registering and the
 * whole UI fails.
 */

import { spawnSync } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { wrapClientCjs } from './wrap-client.mjs'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const tsdown = spawnSync('tsdown', [], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (tsdown.status) process.exit(tsdown.status ?? 1)

const lib = join(packageRoot, 'lib')
const cjsPath = join(lib, 'client.cjs')
const jsPath = join(lib, 'client.js')

let sourcePath = jsPath
try {
  await readFile(cjsPath)
  sourcePath = cjsPath
} catch {
  // tsdown may emit client.js for CJS when that is the only client format.
}

const body = await readFile(sourcePath, 'utf8')
const wrapped = wrapClientCjs(body)
if (sourcePath === cjsPath) {
  await rename(cjsPath, jsPath)
}
await writeFile(jsPath, wrapped)
if (!wrapped.includes('window.__ModuleLoader__.load')) {
  throw new Error('wrapped client bundle did not register with the DSH module loader')
}
