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
      // Integration tests exercise a REAL shared API + DB, so a small fraction of
      // round-trips fail transiently under parallel load (e.g. a downstream DB op
      // that the API maps to a 4xx, or a slow redirect). Retry such cases at the
      // test level — a deterministic regression still fails every attempt, so this
      // is a transient-infra safety net, not a way to paper over real breakage.
      // Override with INTEGRATION_TEST_RETRY (e.g. 0 to disable while debugging).
      // CI=3: under peak full-workspace concurrency a transient blip can recur
      // across two adjacent attempts, so a third attempt — landing slightly after
      // the start-up load spike — clears it. Deeper fix tracked separately: the
      // services map transient infra failures to badRequest instead of retrying.
      retry: Number.parseInt(process.env.INTEGRATION_TEST_RETRY ?? (process.env.CI ? '3' : '1'), 10),
      maxWorkers: integrationMaxWorkers,
      fileParallelism: integrationMaxWorkers > 1,
      pool: 'threads',
      isolate: false
    }
  })
)

export default integrationConfig
