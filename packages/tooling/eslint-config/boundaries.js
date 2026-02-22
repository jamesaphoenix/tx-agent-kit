import boundariesPlugin from 'eslint-plugin-boundaries'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const boundariesConfig = [
  {
    plugins: {
      boundaries: boundariesPlugin
    },
    settings: {
      'boundaries/root-path': resolve(__dirname, '../..'),
      'boundaries/include': ['packages/**/*', 'apps/**/*'],
      'boundaries/ignore': [
        '**/*.test.ts',
        '**/dist/**',
        '**/*.d.ts',
        '**/vitest.config.ts'
      ],
      'boundaries/elements': [
        {
          type: 'temporal-workflow',
          pattern: 'apps/worker/src/workflows*'
        },
        {
          type: 'temporal-activity',
          pattern: 'apps/worker/src/activities*'
        },
        {
          type: 'app',
          pattern: 'apps/*'
        },
        {
          type: 'package',
          pattern: 'packages/*'
        }
      ]
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: 'package',
              allow: ['package']
            },
            {
              from: 'app',
              allow: ['package', 'app', 'temporal-activity'],
              disallow: ['temporal-workflow']
            },
            {
              from: 'temporal-workflow',
              allow: ['temporal-workflow', 'temporal-activity', 'package']
            }
          ]
        }
      ],
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'warn'
    }
  }
]
