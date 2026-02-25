import { defineConfig, mergeConfig } from 'vitest/config'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      name: 'worker-temporal-integration',
      include: ['src/activities.integration.test.ts']
    }
  })
)
