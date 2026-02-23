import { fileURLToPath } from 'node:url'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'
import { resolveIntegrationMaxWorkers } from '@tx-agent-kit/vitest-config/workers'
import { defineConfig, mergeConfig } from 'vitest/config'

const webIntegrationMaxWorkers = resolveIntegrationMaxWorkers()
process.env.WEB_INTEGRATION_MAX_WORKERS = String(webIntegrationMaxWorkers)

export default mergeConfig(
  integrationConfig,
  defineConfig({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react'
    },
    test: {
      name: 'web-integration',
      environment: 'jsdom',
      environmentOptions: {
        jsdom: {
          url: 'http://localhost:3000'
        }
      },
      setupFiles: ['./vitest.integration.setup.ts'],
      include: ['**/*.integration.test.ts', '**/*.integration.test.tsx'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'],
      pool: 'forks',
      maxWorkers: webIntegrationMaxWorkers,
      fileParallelism: webIntegrationMaxWorkers > 1,
      isolate: true,
      passWithNoTests: true
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./', import.meta.url))
      }
    }
  })
)
