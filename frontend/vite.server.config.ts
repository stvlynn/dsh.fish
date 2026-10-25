import backendPackage from '../backend/package.json'
import frontendPackage from './package.json'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const dependencies = Object.keys({
  ...backendPackage.dependencies,
  ...frontendPackage.dependencies,
}).filter((name) => name !== '@dsh-fish/backend')

export default defineConfig({
  publicDir: false,
  plugins: [tsconfigPaths()],
  build: {
    ssr: 'server/index.ts',
    outDir: 'build/node',
    target: 'node24',

    rollupOptions: {
      external: (id) => dependencies.some((name) => id === name || id.startsWith(name + '/')),
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: { noExternal: ['@dsh-fish/backend'] },
})
