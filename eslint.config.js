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
      '**/drizzle/**'
    ]
  },
  ...baseConfig,
  ...domainInvariantConfig,
  ...promiseConfig,
  ...testingConfig,
  ...boundariesConfig
]
