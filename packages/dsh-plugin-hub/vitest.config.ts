import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // The host half is Node; the settings section needs a DOM, so the
    // environment is chosen per file by `@vitest-environment`.
    environment: 'node',
  },
})
