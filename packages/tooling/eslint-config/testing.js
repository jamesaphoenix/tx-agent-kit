import globals from 'globals'
import noOnlyTests from 'eslint-plugin-no-only-tests'
import testingLibrary from 'eslint-plugin-testing-library'

const TEST_FILES = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.integration.test.ts',
  '**/*.integration.test.tsx'
]

/**
 * Web jsdom test files covered by the contention-robust guardrails
 * (signal-based waits via `findBy`/`waitFor`, no fixed sleeps).
 *
 * The glob covers ALL `apps/web` jsdom tests - the component/page `*.test.tsx`
 * files run under the same testing-library + jsdom stack as the integration
 * suite and are subject to the identical flake class (sync `getBy` on
 * async-gated data, `waitFor(() => getBy)` that should be `findBy`, un-awaited
 * findBy/waitFor, fixed sleeps). The `*.test.tsx` glob already matches
 * `*.integration.test.tsx`, so this single glob is a superset. New web tests
 * are guarded automatically the moment they are added. See the `fix-test-flake`
 * skill for the conversion playbook.
 */
const FLAKE_HARDENED_TEST_FILES = ['apps/web/**/*.test.tsx']

export const testingConfig = [
  {
    files: TEST_FILES,
    languageOptions: {
      globals: {
        ...globals.vitest
      }
    },
    plugins: {
      'no-only-tests': noOnlyTests,
      'testing-library': testingLibrary
    },
    rules: {
      'no-only-tests/no-only-tests': 'error'
    }
  },
  {
    // Contention-robustness guardrails, scoped to the entire web jsdom suite via
    // the broad glob above. Each rule maps to a real flake class:
    //  - prefer-find-by: `waitFor(() => getBy)` -> `findBy` (async-arriving data)
    //  - no-await-sync-queries: awaiting a sync getBy is a no-op race
    //  - await-async-queries / await-async-utils: un-awaited findBy/waitFor
    //    resolves after the assertion under load
    files: FLAKE_HARDENED_TEST_FILES,
    rules: {
      'testing-library/prefer-find-by': 'error',
      'testing-library/no-await-sync-queries': 'error',
      'testing-library/await-async-queries': 'error',
      'testing-library/await-async-utils': 'error',
      // Fixed sleeps mask real signals and flake under load. Use a `waitFor`
      // on an observable condition, or fake timers, instead.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='setTimeout'][arguments.length>=2]:not([arguments.1.value=0])",
          message:
            'No fixed sleeps in tests. Wait on an observable signal (waitFor/findBy) or use fake timers.'
        }
      ]
    }
  }
]
