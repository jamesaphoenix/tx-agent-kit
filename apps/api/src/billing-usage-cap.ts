/**
 * Billing Usage Cap — two-level cap invariants.
 *
 * This module is the colocation anchor for `billing-usage-cap.integration.test.ts`,
 * which verifies the org-level and campaign-level usage cap checks and the
 * atomic `monthly_credits_usage.credits_used` increment.
 *
 * The behavior itself is enforced in:
 * - Usage cap service: packages/core/src/domains/billing/application/usage-cap-service.ts
 * - Usage cap repo:    packages/infra/db/src/repositories/usage-cap.ts
 * - Port contract:     packages/core/src/domains/billing/ports/billing-ports.ts
 * - Adapter wiring:    packages/core/src/domains/billing/adapters/billing-adapters.ts
 */
export const BILLING_USAGE_CAP_INVARIANT_IDS = [
  'INV-BILLING-008', // Atomic credits_used increment via INSERT ... ON CONFLICT DO UPDATE
  'REQ-BILLING-008', // Cap check runs BEFORE the debit and leaves the counter untouched on rejection
] as const
