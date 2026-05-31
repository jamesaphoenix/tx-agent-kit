/**
 * Effect-specific consistency rules.
 *
 * - Ban new Promise() constructor in core/API source (use Effect.promise/tryPromise)
 */
export const effectConsistencyConfig = [
  // ── Rule: Ban new Promise() constructor ─────────────────────────────
  // In an Effect-first codebase, new Promise() bypasses Effect's error channel.
  // Use Effect.promise, Effect.tryPromise, or Effect.async instead.
  {
    files: ['packages/core/src/**/*.ts', 'apps/api/src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.integration.test.ts',
      '**/test-*.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Promise"]',
          message:
            'Use Effect.tryPromise() instead of new Promise(). Raw Promise bypasses the Effect error channel.'
        },
        // ── Ban Effect.promise() (use Effect.tryPromise) ───────────────
        // Effect.promise() assumes the promise NEVER rejects — a rejection
        // becomes an unhandled Effect *defect* that bypasses mapCoreError's
        // log+Sentry mapping (a silent failure). Always use Effect.tryPromise
        // so a rejection is a typed, logged, observable error.
        {
          selector: 'CallExpression[callee.object.name="Effect"][callee.property.name="promise"]',
          message:
            'Use Effect.tryPromise() instead of Effect.promise(): a promise rejection under Effect.promise becomes a silent defect that bypasses the log+Sentry boundary. tryPromise keeps it in the observable error channel.'
        }
      ]
    }
  }
]
