import { defineConfig, mergeConfig } from 'vitest/config'
import { unitConfig } from './unit.js'
import { resolveIntegrationMaxWorkers } from './workers.js'

const integrationMaxWorkers = resolveIntegrationMaxWorkers()

export const integrationConfig = mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      testTimeout: Number.parseInt(process.env.INTEGRATION_TEST_TIMEOUT_MS ?? (process.env.CI ? '60000' : '30000'), 10),
      hookTimeout: Number.parseInt(process.env.INTEGRATION_HOOK_TIMEOUT_MS ?? (process.env.CI ? '60000' : '30000'), 10),
      maxWorkers: integrationMaxWorkers,
      fileParallelism: integrationMaxWorkers > 1,
      pool: 'threads',
      isolate: false
    }
  })
)

export default integrationConfig
