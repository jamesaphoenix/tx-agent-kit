import assert from 'node:assert/strict'
import test from 'node:test'
import { domainInvariantConfig } from '../domain-invariants.js'

const collectConfiguredDomainStructureRules = () => {
  const configured = new Set()

  for (const entry of domainInvariantConfig) {
    const rules = entry?.rules ?? {}
    for (const [ruleName, value] of Object.entries(rules)) {
      if (!ruleName.startsWith('domain-structure/')) {
        continue
      }

      if (value === 'off' || value === 0) {
        continue
      }

      configured.add(ruleName.replace('domain-structure/', ''))
    }
  }

  return configured
}

test('domain-invariants enables all critical domain-structure rules', () => {
  const configured = collectConfiguredDomainStructureRules()

  const expectedRules = [
    'require-domain-structure',
    'enforce-layer-boundaries',
    'ports-no-layer-providers',
    'adapters-must-import-port',
    'pure-domain-no-effect-imports',
    'pure-domain-no-infra-imports',
    'no-throw-try-outside-adapters',
    'no-inline-string-union-enums',
    'no-raw-schema-literal-enums',
    'no-inline-pgenum-array',
    'json-columns-require-explicit-drizzle-type',
    'core-adapters-use-db-row-mappers'
  ]

  for (const ruleName of expectedRules) {
    assert.ok(
      configured.has(ruleName),
      `Expected domain-invariants config to enable domain-structure/${ruleName}`
    )
  }
})
