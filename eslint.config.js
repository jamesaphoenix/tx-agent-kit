import { baseConfig } from './packages/tooling/eslint-config/base.js'
import { boundariesConfig } from './packages/tooling/eslint-config/boundaries.js'
import { domainInvariantConfig } from './packages/tooling/eslint-config/domain-invariants.js'
import { promiseConfig } from './packages/tooling/eslint-config/promise.js'
import { testingConfig } from './packages/tooling/eslint-config/testing.js'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.d.ts',
      '**/drizzle/**',
      '**/.expo/**',
      'apps/mobile/*.config.{js,mjs,ts}',
      'apps/mobile/babel.config.js',
      'apps/mobile/vitest.component-setup.ts',
      'apps/docs/**'
    ]
  },
  ...baseConfig,
  ...domainInvariantConfig,
  ...promiseConfig,
  ...testingConfig,
  ...boundariesConfig,
  {
    files: ['apps/mobile/**/*.test.ts', 'apps/mobile/**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/require-await': 'off',
      'promise/param-names': 'off'
    }
  }
]
