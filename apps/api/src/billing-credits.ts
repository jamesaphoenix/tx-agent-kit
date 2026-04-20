/**
 * Billing Credits — credit system invariants.
 *
 * This module exists as the colocation anchor for `billing-credits.integration.test.ts`,
 * which verifies billing invariants (INV-BILLING-*) for the credit system.
 *
 * The invariants themselves are enforced in:
 * - Credit service: packages/core/src/domains/billing/application/credit-service.ts
 * - Credit ledger repo: packages/infra/db/src/repositories/credit-ledger.ts
 * - DB triggers: packages/infra/db/drizzle/migrations/0038_billing_pricing_spec.sql
 * - ESLint: domain-structure/enforce-financial-audit-immutability
 * - pgTAP: packages/infra/db/pgtap/004_billing_immutability.pgtap.sql
 *
 * @spec INV-REQ-BILLING-AND-PRICING-001
 * @spec INV-REQ-BILLING-AND-PRICING-002
 * @spec INV-REQ-BILLING-AND-PRICING-003
 * @spec INV-REQ-BILLING-AND-PRICING-004
 */
export const BILLING_INVARIANT_IDS = [
  'INV-BILLING-001', // credit_ledger append-only
  'INV-BILLING-002', // usage_records append-only
  'INV-BILLING-003', // Reserve/finalize/release lifecycle
  'INV-BILLING-004', // Balance never negative
  'INV-BILLING-005', // Stripe webhook idempotency
  'INV-BILLING-006', // 10% margin markup
  'INV-BILLING-007', // Financial records SET NULL on org delete
  'INV-BILLING-008', // Atomic credits_used increment
  'INV-BILLING-009', // Domain events transactional with credit mutations
  'INV-BILLING-010', // Consumer idempotency
] as const
