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
      '**/*.integration.test.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Promise"]',
          message:
            'Use Effect.promise() or Effect.tryPromise() instead of new Promise(). Raw Promise bypasses the Effect error channel.'
        }
      ]
    }
  }
]
