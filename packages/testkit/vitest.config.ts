import { defineConfig, mergeConfig } from 'vitest/config'
import unitConfig from '@tx-agent-kit/vitest-config/unit'

export default mergeConfig(unitConfig, defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'src/**/*.boilerplate.test.ts']
  }
}))
