import { fileURLToPath } from 'node:url'
import integrationConfig from '@tx-agent-kit/vitest-config/integration'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
  integrationConfig,
  defineConfig({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react'
    },
    test: {
      name: 'mobile-integration',
      setupFiles: ['./vitest.component-setup.ts', './vitest.integration.setup.ts'],
      include: ['**/*.integration.test.ts', '**/*.integration.test.tsx'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/coverage/**'],
      maxWorkers: 1,
      fileParallelism: false,
      passWithNoTests: false
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./', import.meta.url)),
        '@tx-agent-kit/observability/client': fileURLToPath(
          new URL('../../packages/observability/src/client.ts', import.meta.url)
        ),
        'react-native': fileURLToPath(
          new URL('./__mocks__/react-native.ts', import.meta.url)
        )
      }
    }
  })
)
