import { fileURLToPath } from 'node:url'
import unitConfig from '@tx-agent-kit/vitest-config/unit'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
  unitConfig,
  defineConfig({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react'
    },
    test: {
      setupFiles: ['./vitest.component-setup.ts'],
      maxWorkers: 2,
      fileParallelism: true,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.expo/**',
        '**/coverage/**',
        '**/*.integration.test.ts',
        '**/*.integration.test.tsx'
      ]
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./', import.meta.url)),
        '@tx-agent-kit/observability/client': fileURLToPath(
          new URL('../../packages/infra/observability/src/client.ts', import.meta.url)
        ),
        'react-native': fileURLToPath(
          new URL('./__mocks__/react-native.ts', import.meta.url)
        )
      }
    }
  })
)
