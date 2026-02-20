const effectSchemaOnlyRestrictions = {
  paths: [
    {
      name: 'zod',
      message: 'Use `effect/Schema` only. Zod is not allowed in this repository.'
    },
    {
      name: 'valibot',
      message: 'Use `effect/Schema` only. Valibot is not allowed in this repository.'
    },
    {
      name: 'yup',
      message: 'Use `effect/Schema` only. Yup is not allowed in this repository.'
    },
    {
      name: 'joi',
      message: 'Use `effect/Schema` only. Joi is not allowed in this repository.'
    },
    {
      name: 'superstruct',
      message: 'Use `effect/Schema` only. Superstruct is not allowed in this repository.'
    }
  ],
  patterns: [
    {
      group: ['zod/*', 'valibot/*', 'yup/*', 'joi/*', 'superstruct/*'],
      message: 'Use `effect/Schema` only for validation and contracts.'
    }
  ]
}

const drizzleIsolationRestrictions = {
  patterns: [
    {
      group: ['drizzle-orm', 'drizzle-orm/*'],
      message: 'Only `packages/db` may import Drizzle. Use repositories and Effect services elsewhere.'
    }
  ]
}

export const domainInvariantConfig = [
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', effectSchemaOnlyRestrictions]
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tx-agent-kit/db',
              message: 'Web must stay API-first. Call `apps/api` via typed client functions, never DB modules.'
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
      'no-restricted-imports': ['error', drizzleIsolationRestrictions]
    }
  },
  {
    files: ['packages/**/src/domains/*/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(ports|repositories|adapters|services|runtime|ui)(/|$)',
              message: 'Domain layer is innermost and may only import from domain.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/**/src/domains/*/ports/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(repositories|adapters|services|runtime|ui)(/|$)',
              message: 'Ports may depend only on domain/ports.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/**/src/domains/*/{repositories,adapters}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(services|runtime|ui)(/|$)',
              message: 'Repositories/adapters may depend on domain/ports only.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/**/src/domains/*/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(runtime|ui)(/|$)',
              message: 'Services may not import runtime/ui layers.'
            }
          ]
        }
      ]
    }
  }
]
