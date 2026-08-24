/** The id DSH's client module loader expects this bundle to register. */
export const CLIENT_MODULE_ID = '@dsh-fish/hub'

/**
 * Wrap a CJS client bundle for `window.__ModuleLoader__.load`.
 *
 * The harness serves `/plugins/<id>/client.js` and requires that file to
 * register itself. A bare ESM `import` never does, and the whole client
 * (not just this section) then fails to load.
 */
export function wrapClientCjs(body) {
  if (body.includes('window.__ModuleLoader__.load')) return body
  if (/^\s*import\s/m.test(body)) {
    throw new Error(
      'client bundle is still ESM; tsdown must emit CJS before wrapping for the DSH module loader',
    )
  }
  const indented = body
    .split('\n')
    .map((line) => (line === '' ? '' : `    ${line}`))
    .join('\n')
  return (
    'window.__ModuleLoader__.load({\n' +
    `  id: ${JSON.stringify(CLIENT_MODULE_ID)},\n` +
    '  factory: (require) => {\n' +
    '    const module = { exports: {} };\n' +
    '    const exports = module.exports;\n' +
    `${indented}\n` +
    '    return module.exports;\n' +
    '  },\n' +
    '});\n'
  )
}
