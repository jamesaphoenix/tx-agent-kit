import { defineConfig, mergeConfig } from 'vitest/config'
import unitConfig from '@tx-agent-kit/vitest-config/unit'

export default mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      exclude: ['**/*.integration.test.ts']
    }
  })
)
