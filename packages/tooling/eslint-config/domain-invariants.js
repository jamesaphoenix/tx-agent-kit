export const domainInvariantConfig = [
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tx-agent-kit/db',
              message: 'Web must stay API-first. Use `/api/*` routes and typed API clients, never DB access.'
            },
            {
              name: 'drizzle-orm',
              message: 'Web must stay API-first. Only the DB layer may import Drizzle.'
            }
          ],
          patterns: [
            {
              group: ['@tx-agent-kit/db/*', 'drizzle-orm/*'],
              message: 'Web must stay API-first. Keep persistence concerns behind API/core services.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/db/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*'],
              message: 'Only `packages/db` may import Drizzle. Use repositories and Effect services elsewhere.'
            }
          ]
        }
      ]
    }
  }
]
