/**
 * Effect-specific consistency rules.
 *
 * - Ban new Promise() constructor in core/API source (use Effect.promise/tryPromise)
 * - Enforce the `tx-agent-kit-` logger service-name prefix (no bare names like
 *   'db'/'stripe') so the `service` field stays a consistent namespace.
 */

// Every createLogger service name must start with `tx-agent-kit-` — the prefix
// is the namespace that keeps the `service` field greppable across logs/Loki.
// Matches the FIRST argument's literal value only, so `.child('<subsystem>')`
// args and non-literal `createLogger(service)` calls are untouched. See the
// logging package README for the convention.
const createLoggerServiceNamePrefixRule = {
  selector: "CallExpression[callee.name='createLogger'][arguments.0.value=/^(?!tx-agent-kit-)/]",
  message:
    "Logger service names must start with 'tx-agent-kit-'. Use createLogger('tx-agent-kit-<component>') (+ .child('<subsystem>') for API subsystems), never a bare name like 'db' or 'stripe'."
}

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
        },
        // ── Ban infra failure mapped to a 4xx client error ─────────────
        // A "Failed to <verb>" message denotes a repository/port/infra CALL
        // failing — that is a 500 server fault, NOT the client's fault.
        // Mapping it to badRequest/unauthorized/conflict/forbidden/notFound
        // returns the wrong status AND (for 4xx with no recognizable cause)
        // can be demoted to a warn that never reaches Sentry. Use
        // internalError(...) / withInternalError(...) / toCoreInternal(...)
        // so the failure is always logged + captured. Genuine client errors
        // should describe the client problem ("Invalid …", "… already
        // exists", "Not allowed …"), never "Failed to …".
        {
          selector:
            'CallExpression[callee.name=/^(badRequest|unauthorized|conflict|forbidden|notFound)$/][arguments.0.value=/^Failed to /]',
          message:
            "A 'Failed to …' message is an infra/port-call failure (a 500), not a 4xx client error. Use internalError() / withInternalError() / toCoreInternal() so it is logged + sent to Sentry. If this is genuinely the client's fault, describe the client problem instead of 'Failed to …'."
        },
        createLoggerServiceNamePrefixRule
      ]
    }
  },
  {
    // The createLogger prefix invariant for the runtimes/packages NOT covered by
    // the core+api block above (worker + shared infra). Separate block so it
    // doesn't clobber that block's no-restricted-syntax selectors.
    files: ['apps/worker/src/**/*.ts', 'packages/infra/**/src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.integration.test.ts',
      '**/test-*.ts'
    ],
    rules: {
      'no-restricted-syntax': ['error', createLoggerServiceNamePrefixRule]
    }
  }
]
