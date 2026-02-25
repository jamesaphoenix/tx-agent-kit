import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react'
  },
  test: {
    name: 'mobile-integration',
    setupFiles: ['./vitest.component-setup.ts', './vitest.integration.setup.ts'],
    include: ['**/*.integration.test.ts', '**/*.integration.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/coverage/**'],
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    sequence: {
      groupOrder: 2
    },
    passWithNoTests: false
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
