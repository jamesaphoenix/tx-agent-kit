import promisePlugin from 'eslint-plugin-promise'

export const promiseConfig = [
  {
    plugins: {
      promise: promisePlugin
    },
    rules: {
      'promise/always-return': [
        'error',
        {
          ignoreLastCallback: false
        }
      ],
      'promise/catch-or-return': [
        'error',
        {
          allowFinally: true,
          allowThen: false,
          terminationMethod: ['catch', 'finally']
        }
      ],
      'promise/prefer-await-to-then': 'warn',
      'promise/prefer-await-to-callbacks': 'off',
      'promise/no-return-wrap': [
        'error',
        {
          allowReject: true
        }
      ],
      'promise/param-names': 'error',
      'promise/no-new-statics': 'error',
      'promise/no-return-in-finally': 'error',
      'promise/no-nesting': 'warn',
      'promise/no-promise-in-callback': 'warn',
      'promise/no-callback-in-promise': 'warn',
      'promise/avoid-new': 'off',
      'promise/valid-params': 'error',
      'promise/no-multiple-resolved': 'error'
    }
  },
  {
    files: [
      'apps/worker/src/workflows.ts',
      'apps/worker/src/workflows/**/*.ts'
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'promise/prefer-await-to-then': 'error',
      'promise/no-nesting': 'error'
    }
  },
  {
    files: [
      'apps/worker/src/activities.ts',
      'apps/worker/src/activities/**/*.ts'
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      'promise/prefer-await-to-then': 'warn'
    }
  },
  {
    files: ['apps/api/src/routes/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'promise/prefer-await-to-then': 'warn',
      'promise/catch-or-return': [
        'warn',
        {
          allowFinally: true,
          allowThen: false,
          terminationMethod: ['catch', 'finally']
        }
      ]
    }
  }
]
