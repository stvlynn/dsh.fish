import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Test config is separate from `vite.config.ts` on purpose.
 *
 * The app config loads the Cloudflare plugin so dev and preview run inside
 * workerd; reusing it here would try to run the test runner itself inside a
 * Worker. Frontend tests cover components and pure helpers, which belong in a
 * plain DOM environment — Worker behavior is exercised by the backend's tests
 * and by `wrangler dev`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'workers/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'server/**/*.test.ts',
    ],
    environment: 'node',
  },
})
