import { configDefaults, defineConfig } from 'vitest/config'
import { resolveUnitMaxWorkers } from './workers.js'

const unitMaxWorkers = resolveUnitMaxWorkers()

export const unitConfig = defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: unitMaxWorkers,
    isolate: true,
    fileParallelism: unitMaxWorkers > 1,
    passWithNoTests: false,
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**'
    ]
  }
})

export default unitConfig
