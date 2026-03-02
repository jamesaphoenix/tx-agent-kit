/**
 * Unicorn rules — modern JS best practices and common bug prevention.
 *
 * Selected from @nkzw/eslint-config; skips rules that conflict with
 * Effect patterns, SSR guards, or would cause excessive churn.
 */
import unicorn from 'eslint-plugin-unicorn'

export const unicornConfig = [
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/lib/api/generated/**/*.{ts,tsx}'],
    plugins: { unicorn },
    rules: {
      'unicorn/catch-error-name': 'error',
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/no-useless-promise-resolve-reject': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/numeric-separators-style': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-optional-catch-binding': 'error',
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-string-slice': 'error',
      'unicorn/prefer-structured-clone': 'error'
    }
  },
  // ── TanStack devtools: JSON clone is an intentional structuredClone fallback ──
  {
    files: ['apps/web/components/devtools/TanStackStoreDevtools.tsx'],
    rules: {
      'unicorn/prefer-structured-clone': 'off'
    }
  }
]
