import { describe, expect, it } from 'vitest'

const scanner = await import('./enforce-product-leak-and-secret-policy.mjs')

const basePolicy = {
  allowedProductLeakPathPrefixes: [],
  denyTerms: [{ id: 'octospark_title', value: 'Octospark' }],
  skipPathPatterns: [],
  secretScanPathPatterns: ['^\\.env($|\\.)'],
  allowSecretValuePatterns: ['^$', '^op://', '^\\$\\{\\{\\s*secrets\\.', '^<[^>]+>$'],
  localSecretDefaultPaths: [],
  localSecretDefaultValues: []
}

describe('product leak and secret policy scanner', () => {
  it('flags forbidden source product terms', () => {
    const findings = scanner.scanContent(
      'apps/api/src/example.ts',
      'const label = "Octospark";',
      basePolicy
    )

    expect(findings).toEqual([
      expect.objectContaining({
        type: 'product-leak',
        id: 'octospark_title',
        line: 1
      })
    ])
  })

  it('flags forbidden source product terms in paths', () => {
    const findings = scanner.scanFilePath(
      'docs/examples/Octospark-overview.md',
      basePolicy
    )

    expect(findings).toEqual([
      expect.objectContaining({
        type: 'product-leak',
        id: 'octospark_title',
        line: 0
      })
    ])
  })

  it('flags plaintext secret assignments in env-like files', () => {
    const findings = scanner.scanContent(
      '.env.example',
      'AUTH_SECRET=super-secret-value',
      basePolicy
    )

    expect(findings).toEqual([
      expect.objectContaining({
        type: 'plaintext-secret',
        id: 'AUTH_SECRET',
        line: 1
      })
    ])
  })

  it('allows 1Password secret references', () => {
    const findings = scanner.scanContent(
      '.env.example',
      'AUTH_SECRET=op://tx-agent-kit-services/dev/AUTH_SECRET',
      basePolicy
    )

    expect(findings).toEqual([])
  })
})
