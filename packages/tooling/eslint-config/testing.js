import globals from 'globals'

export const testingConfig = [
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: {
        ...globals.vitest
      }
    }
  }
]
