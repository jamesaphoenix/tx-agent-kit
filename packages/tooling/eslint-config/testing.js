import globals from 'globals'
import noOnlyTests from 'eslint-plugin-no-only-tests'

export const testingConfig = [
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx'
    ],
    languageOptions: {
      globals: {
        ...globals.vitest
      }
    },
    plugins: {
      'no-only-tests': noOnlyTests
    },
    rules: {
      'no-only-tests/no-only-tests': 'error'
    }
  }
]
