import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    projects: [
      'packages/infra/ai/vitest.config.ts',
      'packages/infra/auth/vitest.config.ts',
      'packages/contracts/vitest.config.ts',
      'packages/core/vitest.config.ts',
      'packages/infra/db/vitest.config.ts',
      'packages/infra/logging/vitest.config.ts',
      'packages/infra/observability/vitest.config.ts',
      'packages/temporal-client/vitest.config.ts',
      'packages/testkit/vitest.config.ts',
      'packages/tooling/scaffold/vitest.config.ts',
      'apps/api/vitest.config.ts',
      'apps/web/vitest.config.ts',
      'apps/worker/vitest.config.ts',
      'apps/mobile/vitest.config.ts'
    ]
  }
})
