import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const noDeferredWorkPlugin = {
  meta: { name: 'no-deferred-work', version: '0.1.0' },
  rules: {
    'no-todo-comments': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const pattern = /\b(todo|fixme|hack)\b/i
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const match = pattern.exec(comment.value)
              if (match) {
                context.report({
                  loc: comment.loc,
                  message:
                    `'${match[1].toUpperCase()}' comment found. ` +
                    'Do not defer work — fix the root cause now. ' +
                    'If it needs a design decision, ask the user. ' +
                    'If code is intentionally skipped (e.g. it.skip), explain why in the skip reason, not a TODO.'
                })
              }
            }
          }
        }
      }
    }
  }
}

export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'no-deferred-work': noDeferredWorkPlugin
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          defaultProject: 'tsconfig.json'
        },
        tsconfigRootDir: process.cwd()
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      'no-constant-binary-expression': 'error',
      'no-console': 'error',
      'no-warning-comments': 'off',
      'no-deferred-work/no-todo-comments': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': true,
          'ts-nocheck': true,
          'ts-check': false
        }
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports'
        }
      ],
      // Allow numbers in template literals — `${count}` is safe and common
      // Explicitly disable all other allow* options to preserve strictTypeChecked intent
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: false,
          allowNullish: false,
          allowAny: false,
          allowRegExp: false,
          allowNever: false
        }
      ],
      // Allow void returns in arrow shorthand — e.g. `arr.forEach(x => doSomething(x))`
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true }
      ]
    }
  },
  // ── Generated API clients (Orval output) ───────────────────────────
  {
    files: [
      'apps/web/lib/api/generated/**/*.{ts,tsx}',
      'apps/mobile/lib/api/generated/**/*.{ts,tsx}'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/consistent-type-exports': 'off'
    }
  },
  // ── Orval mutators (hand-authored transport adapters) ─────────────
  {
    files: [
      'apps/web/lib/api/orval-mutator.ts',
      'apps/mobile/lib/api/orval-mutator.ts'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/consistent-type-exports': 'off'
    }
  },
  // ── Test files: relax strictness for test ergonomics ───────────────
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
      '**/test-*.ts',
      '**/test-*.tsx'
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off'
    }
  },
  // ── Testkit: test helpers use non-null assertions heavily ──────────
  {
    files: ['packages/testkit/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off'
    }
  },
  // ── DB schema: pgTable extraConfig must use array syntax (not deprecated object syntax) ──
  // The no-deprecated rule is now enabled for schema.ts since we migrated to array syntax.
  // If this fires, convert `(t) => ({...})` to `(t) => [...]` in the pgTable call.
]
