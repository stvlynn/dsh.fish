import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import { defineConfig, type Plugin } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * `@types/mdx` is a .d.ts package whose `index.d.ts` imports `mdx/types` and
 * `*.mdx`. Vite's dep optimizer treats it as JS, and the Cloudflare workerd
 * dev server dies. Stub those specifiers so types stay for `tsc` only.
 */
function stubMdxTypesPackage(): Plugin {
  const virtual = '\0stub-mdx-types'
  const esbuildPlugin = {
    name: 'stub-mdx-types',
    setup(build: {
      onResolve: (
        options: { filter: RegExp },
        callback: () => { path: string; namespace: string },
      ) => void
      onLoad: (
        options: { filter: RegExp; namespace: string },
        callback: () => { contents: string; loader: 'js' },
      ) => void
    }) {
      build.onResolve({ filter: /^(mdx\/types(?:\.js)?|@types\/mdx|\*\.mdx)$/ }, () => ({
        path: 'stub-mdx-types',
        namespace: 'stub-mdx-types',
      }))
      build.onLoad({ filter: /.*/, namespace: 'stub-mdx-types' }, () => ({
        contents: 'export {}',
        loader: 'js',
      }))
    },
  }

  return {
    name: 'stub-mdx-types',
    enforce: 'pre',
    config() {
      return {
        optimizeDeps: {
          exclude: ['@types/mdx'],
          esbuildOptions: { plugins: [esbuildPlugin] },
        },
        ssr: {
          optimizeDeps: {
            exclude: ['@types/mdx'],
            esbuildOptions: { plugins: [esbuildPlugin] },
          },
        },
      }
    },
    resolveId(id) {
      if (id === 'mdx/types' || id === 'mdx/types.js' || id === '@types/mdx' || id === '*.mdx') {
        return virtual
      }
    },
    load(id) {
      if (id === virtual) return 'export {}'
    },
  }
}

export default defineConfig({
  plugins: [
    stubMdxTypesPackage(),
    // Compile MDX at build time and generate separate server/browser indexes.
    // The browser index uses dynamic imports, so each article is its own chunk.
    fumadocsMdx(),
    // Runs dev and preview inside workerd, so local behavior matches production
    // bindings rather than a Node emulation of them.
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      // CI uses local fixtures and has no Cloudflare account credentials.
      // Production deployment still reads the remote VPC binding from Wrangler.
      remoteBindings: !process.env.CI,
    }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
})
