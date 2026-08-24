import { defineConfig } from 'tsdown'

/**
 * Self-contained build.
 *
 * A git install of this package runs `prepare`, and the harness docs are clear
 * that such a build must not assume a sibling monorepo checkout — so this
 * config transpiles `src/` on its own, with no project references.
 *
 * The browser half is CJS because DSH's client module loader executes
 * `client.js` as a factory with `require`, not as an ESM module.
 */
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      install: 'src/install.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    dts: { emitDtsOnly: false },
    clean: true,
    target: 'node20',
    external: [/^@deepseek-ai\//, /^node:/, /^react(\/|$)/],
  },
  {
    entry: {
      client: 'src/client/index.tsx',
    },
    outDir: 'lib',
    format: ['cjs'],
    dts: false,
    clean: false,
    target: 'es2022',
    // React and the client packages come from the harness client bundle: a
    // second React in this chunk would be a second renderer.
    external: [/^@deepseek-ai\//, /^react(\/|$)/],
  },
])
