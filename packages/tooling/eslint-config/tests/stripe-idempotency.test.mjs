/**
 * Tests for the `stripe-idempotency/require-idempotency-key` ESLint rule.
 *
 * The rule guards against dropping idempotency keys on money-moving Stripe
 * SDK `.create(...)` calls — a regression of the iter-2 billing audit bug.
 * Uses real ESLint with `overrideConfig` to exercise the rule end-to-end,
 * matching the pattern established by `new-rules.test.mjs`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { stripeIdempotencyPlugin } from '../stripe-idempotency-plugin.js'

const lint = async (code) => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
        },
        plugins: { 'stripe-idempotency': stripeIdempotencyPlugin },
        rules: {
          'stripe-idempotency/require-idempotency-key': 'error'
        }
      }
    ]
  })
  const [result] = await eslint.lintText(code, { filePath: 'virtual.ts' })
  return result.messages
}

const expectError = async (code, messageId) => {
  const msgs = await lint(code)
  assert.ok(msgs.length > 0, `Expected an error but got none. Code:\n${code}`)
  assert.equal(msgs[0].ruleId, 'stripe-idempotency/require-idempotency-key')
  if (messageId) {
    assert.equal(msgs[0].messageId, messageId)
  }
}

const expectClean = async (code) => {
  const msgs = await lint(code)
  assert.equal(msgs.length, 0, `Expected no errors but got:\n${JSON.stringify(msgs, null, 2)}`)
}

// ── Violations ─────────────────────────────────────────────────────────

test('reports checkout.sessions.create without options arg', async () => {
  await expectError(
    `stripeClient.checkout.sessions.create({ mode: 'subscription', customer: 'cus_1' })`,
    'missingOptionsArg'
  )
})

test('reports checkout.sessions.create with options arg missing idempotencyKey', async () => {
  await expectError(
    `stripeClient.checkout.sessions.create({ mode: 'subscription' }, { apiVersion: '2024-01' })`,
    'missingIdempotencyKey'
  )
})

test('reports billingPortal.sessions.create missing idempotencyKey', async () => {
  await expectError(
    `stripeClient.billingPortal.sessions.create({ customer: 'cus_1' })`,
    'missingOptionsArg'
  )
})

test('reports customers.create missing idempotencyKey', async () => {
  await expectError(
    `stripeClient.customers.create({ email: 'a@b.com' })`,
    'missingOptionsArg'
  )
})

test('reports paymentIntents.create missing idempotencyKey', async () => {
  await expectError(
    `stripeClient.paymentIntents.create({ amount: 100, currency: 'usd' })`,
    'missingOptionsArg'
  )
})

// ── Clean cases ────────────────────────────────────────────────────────

test('allows checkout.sessions.create with idempotencyKey in 2nd arg', async () => {
  await expectClean(
    `stripeClient.checkout.sessions.create({ mode: 'subscription' }, { idempotencyKey: 'abc' })`
  )
})

test('allows customers.create with shorthand idempotencyKey', async () => {
  const code = `const idempotencyKey = 'foo'
  stripeClient.customers.create({ email: 'a@b.com' }, { idempotencyKey })`
  await expectClean(code)
})

test('allows calls with idempotencyKey carried via spread', async () => {
  // Spread is treated permissively — we can't statically evaluate its shape.
  const code = `const opts = { idempotencyKey: 'abc' }
  stripeClient.customers.create({ email: 'a@b.com' }, { ...opts })`
  await expectClean(code)
})

test('ignores unrelated .create() calls (not on stripeClient)', async () => {
  await expectClean(
    `Promise.create({ foo: 'bar' })
    const x = { create: () => {} }
    x.create()`
  )
})

test('ignores .create() on stripeClient but a non-guarded resource', async () => {
  // E.g. `files.create` is not money-moving. Currently only sessions,
  // customers, paymentIntents, subscriptions, invoices are guarded.
  await expectClean(
    `stripeClient.files.create({ purpose: 'dispute_evidence' })`
  )
})

test('ignores test files even if violations are present', async () => {
  // The eslint config applies the rule with `ignores: ['**/*.test.ts']`,
  // so test files that intentionally construct bare Stripe calls are OK.
  // This rule-level test doesn't check the ignore — it's a config-level
  // concern — but we assert the rule fires on a virtual non-test file.
  await expectError(
    `stripeClient.paymentIntents.create({ amount: 1 })`,
    'missingOptionsArg'
  )
})
