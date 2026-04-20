import { defineConfig, mergeConfig } from 'vitest/config'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'

const includeLiveSuites = process.env.TESTKIT_INCLUDE_LIVE_INTEGRATION === '1'
const includeCiOnlySuites = process.env.INTEGRATION_INCLUDE_CI_ONLY === '1'

const ciOnlyExcludes = includeCiOnlySuites
  ? []
  : [
      'src/command-entrypoints.integration.test.ts',
      'src/start-dev-services.integration.test.ts'
    ]

const liveExcludes = includeLiveSuites
  ? []
  : [
      'src/deploy-k3s-live.integration.test.ts',
      'src/deploy-tunnel-live.integration.test.ts'
    ]

export default mergeConfig(
  integrationConfig,
  defineConfig({
    test: {
      name: 'testkit-integration',
      include: ['src/**/*.integration.test.ts'],
      exclude: [...ciOnlyExcludes, ...liveExcludes]
    }
  })
)
