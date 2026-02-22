import { fileURLToPath } from 'node:url'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'
import { defineConfig, mergeConfig } from 'vitest/config'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const webIntegrationMaxWorkers = parsePositiveInt(process.env.WEB_INTEGRATION_MAX_WORKERS, 3)

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
      fileParallelism: true,
      sequence: {
        groupOrder: 3
      },
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
