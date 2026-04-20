import { fileURLToPath } from 'node:url'
import { resolveIntegrationMaxWorkers } from '@tx-agent-kit/vitest-config/workers'
import { defineConfig } from 'vitest/config'

const resolveFromConfig = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url).toString())

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
    // Mobile still needs pool:forks + isolate:true so the react-native
    // mock (__mocks__/react-native.ts) gets a fresh module graph per
    // test file — concurrent tests sharing the same module instance
    // corrupt the global fetch/AsyncStorage stubs. Each forked child
    // still gets its own isolated module graph under the new settings.
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // fileParallelism flipped on. Previous config pinned mobile to one
    // serial fork AND sequence.groupOrder:2 so mobile only started
    // AFTER every other project's tests finished — JSON report showed
    // 8 mobile files running sequentially with ~3s gaps, ~22s tail on
    // wall-clock. Drop those pins: mobile inherits the workspace
    // maxWorkers (same as other integration projects, required by
    // vitest when projects share a sequence.groupOrder), and files
    // within the mobile project run in parallel. Each fork still gets
    // its own module graph via isolate:true, so the react-native mock
    // globals stay safely isolated per file.
    // Mobile must share maxWorkers with other integration projects
    // because they all live in the same sequence.groupOrder bucket —
    // vitest errors otherwise. Use the same helper api/web/testkit use.
    maxWorkers: resolveIntegrationMaxWorkers(),
    fileParallelism: true,
    isolate: true,
    passWithNoTests: false
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
