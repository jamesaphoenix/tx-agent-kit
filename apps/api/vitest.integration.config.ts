import { defineConfig, mergeConfig } from 'vitest/config'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'

export default mergeConfig(integrationConfig, defineConfig({
  test: {
    name: 'api-integration',
    include: ['src/**/*.integration.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    sequence: {
      groupOrder: 1
    }
  }
}))
