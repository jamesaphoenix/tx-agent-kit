import { defineConfig, mergeConfig } from 'vitest/config'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      name: 'ai-integration',
      include: ['src/**/*.integration.test.ts']
    }
  })
)
