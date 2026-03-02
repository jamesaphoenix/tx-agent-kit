/**
 * Type-safety rules cherry-picked for agent safety.
 *
 * - Exhaustive switch checks (catch missing union/enum cases)
 * - Consistent type exports (pairs with consistent-type-imports)
 * - Prefer optional chain (a && a.b → a?.b)
 * - Prefer nullish coalescing (|| → ?? for falsy-but-valid values)
 */
export const typeSafetyConfig = [
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true }
      ],
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } }
      ]
    }
  },
  // ── Generated API clients: disable type-safety rules that conflict with codegen output ──
  {
    files: [
      'apps/web/lib/api/generated/**/*.{ts,tsx}',
      'apps/mobile/lib/api/generated/**/*.{ts,tsx}',
      'apps/web/lib/api/orval-mutator.ts',
      'apps/mobile/lib/api/orval-mutator.ts'
    ],
    rules: {
      '@typescript-eslint/consistent-type-exports': 'off'
    }
  }
]
