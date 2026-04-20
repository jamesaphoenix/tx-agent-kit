/**
 * ESLint plugin: enforce that every Stripe SDK `.create(...)` call on a
 * money-moving or resource-creating endpoint passes an `idempotencyKey`
 * in its options argument.
 *
 * Why this rule exists:
 *   - Iter-2 of the billing audit found 3 checkout/portal session
 *     creation calls missing `{ idempotencyKey }`. Under a lost-response
 *     network retry, Stripe would create duplicate sessions — potential
 *     double-charge on the customer.
 *   - The Stripe Node SDK accepts options (including idempotencyKey) as
 *     an optional 2nd argument. TypeScript will NOT catch a missing key
 *     because options is optional at the SDK type level.
 *   - A regex-based lint is fragile (we already hit a template-literal
 *     parsing bug). An AST-based ESLint rule is precise and gets IDE
 *     integration for free.
 *
 * What it enforces:
 *   - Any `stripeClient.<...>.<resource>.create(body, opts?)` call where
 *     `<resource>` is in the guarded list MUST pass an `opts` object
 *     containing a Property with key name `idempotencyKey`.
 *
 * Guarded resources:
 *   - `sessions` (covers `checkout.sessions` AND `billingPortal.sessions`)
 *   - `customers`
 *   - `paymentIntents`
 *   - `subscriptions`
 *   - `invoices`
 *
 * The root identifier is pinned to `stripeClient` to avoid false
 * positives on unrelated `.create()` calls (e.g. `Promise.create`).
 */

const GUARDED_PENULTIMATE_NAMES = new Set([
  'sessions',
  'customers',
  'paymentIntents',
  'subscriptions',
  'invoices'
])

const STRIPE_CLIENT_IDENTIFIERS = new Set(['stripeClient'])

/**
 * Walk a MemberExpression chain down to its root Identifier, if any.
 * Returns `null` for ChainExpression / ThisExpression / computed nodes.
 */
const resolveRootIdentifierName = (node) => {
  let current = node
  // Unwrap optional chaining
  if (current && current.type === 'ChainExpression') {
    current = current.expression
  }
  while (current && current.type === 'MemberExpression') {
    if (current.computed) {
      return null
    }
    current = current.object
  }
  if (current && current.type === 'Identifier') {
    return current.name
  }
  return null
}

/**
 * Given a CallExpression on a `.create` callee, return the penultimate
 * property name (the Stripe resource group), e.g. `sessions` from
 * `stripeClient.checkout.sessions.create`. Returns `null` if the chain
 * is too short.
 */
const resolvePenultimateName = (callee) => {
  // callee is: MemberExpression { object: X, property: { name: 'create' } }
  // We want X.property.name
  if (!callee || callee.type !== 'MemberExpression') {
    return null
  }
  const parent = callee.object
  if (!parent || parent.type !== 'MemberExpression' || parent.computed) {
    return null
  }
  const property = parent.property
  if (!property || property.type !== 'Identifier') {
    return null
  }
  return property.name
}

/**
 * Check whether an ObjectExpression contains a Property (or shorthand)
 * with key `idempotencyKey`. Returns true for both `{ idempotencyKey }`
 * and `{ idempotencyKey: foo }`. Spread elements are treated as
 * potentially containing the key — the rule errs on the permissive
 * side there because we can't statically evaluate a spread's shape.
 */
const objectHasIdempotencyKey = (node) => {
  if (!node || node.type !== 'ObjectExpression') {
    return false
  }
  for (const prop of node.properties) {
    if (prop.type === 'SpreadElement') {
      // Unknown shape — assume caller propagates idempotencyKey through
      // the spread. Safer to allow than to produce false positives.
      return true
    }
    if (prop.type === 'Property' && !prop.computed) {
      const key = prop.key
      if (key && key.type === 'Identifier' && key.name === 'idempotencyKey') {
        return true
      }
      if (key && key.type === 'Literal' && key.value === 'idempotencyKey') {
        return true
      }
    }
  }
  return false
}

const createRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `idempotencyKey` on money-moving Stripe SDK `.create()` calls to prevent duplicate-resource creation under network retry.'
    },
    messages: {
      missingIdempotencyKey:
        'Stripe `stripeClient.{{resource}}.create(...)` is missing `idempotencyKey` in its options argument. All money-moving or resource-creating Stripe SDK calls must pass an idempotency key so a lost-response network retry cannot produce a duplicate Stripe object. See iter-2 of the billing audit for the bug this rule prevents.',
      missingOptionsArg:
        'Stripe `stripeClient.{{resource}}.create(...)` is missing its options argument entirely. Pass `{ idempotencyKey: <stable-key> }` as the second argument to prevent duplicate Stripe resources on network retry.'
    },
    schema: []
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) {
          return
        }
        const calleeProperty = callee.property
        if (!calleeProperty || calleeProperty.type !== 'Identifier' || calleeProperty.name !== 'create') {
          return
        }

        const rootName = resolveRootIdentifierName(callee)
        if (!rootName || !STRIPE_CLIENT_IDENTIFIERS.has(rootName)) {
          return
        }

        const penultimate = resolvePenultimateName(callee)
        if (!penultimate || !GUARDED_PENULTIMATE_NAMES.has(penultimate)) {
          return
        }

        const optionsArg = node.arguments[1]
        if (!optionsArg) {
          context.report({
            node,
            messageId: 'missingOptionsArg',
            data: { resource: penultimate }
          })
          return
        }

        if (!objectHasIdempotencyKey(optionsArg)) {
          context.report({
            node,
            messageId: 'missingIdempotencyKey',
            data: { resource: penultimate }
          })
        }
      }
    }
  }
}

export const stripeIdempotencyPlugin = {
  meta: {
    name: '@tx-agent-kit/stripe-idempotency-plugin',
    version: '0.1.0'
  },
  rules: {
    'require-idempotency-key': createRule
  }
}
