import { defineConfig, mergeConfig } from 'vitest/config'
import { unitConfig } from './unit.js'
import { resolveIntegrationMaxWorkers } from './workers.js'

const integrationMaxWorkers = resolveIntegrationMaxWorkers()

export const integrationConfig = mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      testTimeout: 60000,
      hookTimeout: 60000,
      maxWorkers: integrationMaxWorkers,
      fileParallelism: integrationMaxWorkers > 1
    }
  })
)

export default integrationConfig
