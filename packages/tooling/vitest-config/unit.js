import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import { resolveUnitMaxWorkers } from './workers.js'

// Share V8 bytecode across vitest's short-lived forked workers (the web
// integration project alone spawns ~50 per run). Externalized node_modules
// load through the native ESM loader, so Node's on-disk compile cache
// (Node >= 22.8) skips recompiling react/jsdom/effect/etc. in every fork.
// Content-keyed and safe to share across worktrees; measured ~10% off the
// integration suite wall clock. Config files load in the main process before
// worker pools spawn, so setting it here covers every vitest entry point.
process.env.NODE_COMPILE_CACHE ??= resolve(tmpdir(), 'tx-agent-kit-vitest-compile-cache')

// Tests always run with NODE_ENV=test. Vitest only defaults this when the
// variable is UNSET - and the integration harness sources .env, which carries
// NODE_ENV=development into every vitest worker. React then runs its
// development build inside jsdom (dev warnings, double-invocations, slower
// reconciliation): measured 3.7x slower web test bodies (~25s -> ~93s for the
// web suite alone). The harness-spawned API/worker already force
// NODE_ENV=test; this does the same for the test processes themselves.
// (Object.assign because @types/node declares NODE_ENV readonly.)
Object.assign(process.env, { NODE_ENV: 'test' })

const unitMaxWorkers = resolveUnitMaxWorkers()

export const unitConfig = defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: unitMaxWorkers,
    isolate: true,
    fileParallelism: unitMaxWorkers > 1,
    passWithNoTests: false,
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**'
    ]
  }
})

export default unitConfig
