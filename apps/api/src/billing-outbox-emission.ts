/**
 * Billing Outbox Emission — transactional outbox invariants.
 *
 * This module is the colocation anchor for
 * `billing-outbox-emission.integration.test.ts`, which verifies that billing
 * threshold-crossing and state-change events are committed to `domain_events`
 * in the same DB transaction as the credit mutation that triggers them.
 *
 * The behavior itself is enforced in:
 * - Credit service:       packages/core/src/domains/billing/application/credit-service.ts
 * - Usage cap service:    packages/core/src/domains/billing/application/usage-cap-service.ts
 * - Credit ledger repo:   packages/infra/db/src/repositories/credit-ledger.ts
 * - Usage cap repo:       packages/infra/db/src/repositories/usage-cap.ts
 * - Domain events helper: packages/infra/db/src/repositories/domain-events.ts
 * - Port contracts:       packages/core/src/domains/billing/ports/billing-ports.ts
 * - Public event contract: packages/core/src/domains/billing/events.ts
 */
export const BILLING_OUTBOX_EMISSION_INVARIANT_IDS = [
  'INV-BILLING-009', // Domain events commit in the same tx as the credit mutation
  'REQ-BILLING-008'  // 80 % / 95 % / 100 % usage cap thresholds emit typed events
] as const
