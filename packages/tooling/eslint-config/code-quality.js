/**
 * Code quality rules that apply broadly across the codebase.
 *
 * - Ban nested ternaries (readability)
 * - Ban require() in TypeScript (enforce ESM)
 * - Ban floating void expressions (error swallowing)
 * - Remove unused imports (auto-fixable)
 * - Enforce consistent code style (curly, shorthand, arrow callbacks, spread)
 */
import unusedImports from 'eslint-plugin-unused-imports'

export const codeQualityConfig = [
  // ── Rule: Modern JS style + unused imports ────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/lib/api/generated/**/*.{ts,tsx}'],
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      // Delegate unused-import detection to unused-imports plugin (auto-fixable).
      // Delegate unused-var detection to unused-imports wrapper to avoid
      // duplicate reports with @typescript-eslint/no-unused-vars.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      curly: 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error'
    }
  },

  // ── Rule: Ban nested ternaries ──────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      '**/lib/api/generated/**/*.{ts,tsx}',
      'packages/tooling/scaffold/**/*.{ts,tsx}'
    ],
    rules: {
      'no-nested-ternary': 'error'
    }
  },

  // Disable nested ternary check for generated API clients (Orval output)
  {
    files: [
      'apps/web/lib/api/generated/**/*.{ts,tsx}',
      'apps/mobile/lib/api/generated/**/*.{ts,tsx}'
    ],
    rules: {
      'no-nested-ternary': 'off'
    }
  },

  // ── Rule: Ban require() in TypeScript source ────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['scripts/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'error'
    }
  },

  // ── Rule: Ban floating void expressions ─────────────────────────────
  // void is used to silence no-floating-promises but swallows errors.
  // Use Effect.runFork, .catch(), or await instead.
  {
    files: ['packages/**/src/**/*.{ts,tsx}', 'apps/**/src/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
      'apps/api/src/server-lib.ts',
      'apps/api/src/openapi.ts',
      'apps/worker/src/index.ts',
      'packages/testkit/src/command-entrypoints.ts',
      'packages/infra/observability/src/client.ts',
      'packages/tooling/scaffold/src/cli.ts'
    ],
    rules: {
      'no-void': ['error', { allowAsStatement: false }]
    }
  }
]
