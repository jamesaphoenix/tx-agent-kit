import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    maxWorkers: 1,
    isolate: true,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    projects: [
      'packages/auth/vitest.config.ts',
      'packages/core/vitest.config.ts',
      'apps/api/vitest.config.ts'
    ]
  }
})
