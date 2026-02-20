import boundaries from 'eslint-plugin-boundaries'

export const boundariesConfig = [
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'web', pattern: 'apps/web/**' },
        { type: 'api', pattern: 'apps/api/**' },
        { type: 'worker', pattern: 'apps/worker/**' },
        { type: 'db', pattern: 'packages/db/**' },
        { type: 'core', pattern: 'packages/core/**' },
        { type: 'contracts', pattern: 'packages/contracts/**' },
        { type: 'auth', pattern: 'packages/auth/**' },
        { type: 'observability', pattern: 'packages/observability/**' }
      ]
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: 'web',
              allow: ['contracts', 'auth', 'observability', 'web']
            }
          ]
        }
      ]
    }
  }
]
