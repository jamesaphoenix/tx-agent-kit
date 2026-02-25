import { fileURLToPath } from 'node:url'
import unitConfig from '@tx-agent-kit/vitest-config/unit'
import { defineConfig, mergeConfig } from 'vitest/config'

const resolveFromConfig = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url).toString())

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
        '@': resolveFromConfig('./'),
        '@tx-agent-kit/observability/client': resolveFromConfig(
          '../../packages/infra/observability/src/client.ts'
        ),
        'react-native': resolveFromConfig('./__mocks__/react-native.ts')
      }
    }
  })
)
