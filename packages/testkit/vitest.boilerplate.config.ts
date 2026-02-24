import { defineConfig, mergeConfig } from 'vitest/config'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      name: 'testkit-boilerplate',
      include: ['src/**/*.boilerplate.test.ts']
    }
  })
)
