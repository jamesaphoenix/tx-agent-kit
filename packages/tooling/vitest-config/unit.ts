import { defineConfig } from 'vitest/config'

export const unitConfig = defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    isolate: true,
    fileParallelism: false,
    passWithNoTests: true
  }
})

export default unitConfig
