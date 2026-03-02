import { defineConfig, mergeConfig } from 'vitest/config'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'

const includeLiveSuites = process.env.TESTKIT_INCLUDE_LIVE_INTEGRATION === '1'

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      name: 'testkit-integration',
      include: ['src/**/*.integration.test.ts'],
      exclude: includeLiveSuites
        ? []
        : [
            'src/deploy-k3s-live.integration.test.ts',
            'src/deploy-tunnel-live.integration.test.ts'
          ]
    }
  })
)
