/**
 * Billing Storage — prepaid storage overage invariants.
 *
 * This module is the colocation anchor for `billing-storage.integration.test.ts`,
 * which verifies the three `StorageBillingServicePort` methods against the
 * real DB-backed service: the upload-time pre-check, the idempotent overage
 * debit, and the monthly reconciliation job.
 *
 * Behavior lives in:
 * - Storage billing service: packages/core/src/domains/billing/application/storage-billing-service.ts
 * - Storage usage repo:      packages/infra/db/src/repositories/storage-usage.ts
 * - Port contracts:          packages/core/src/domains/billing/ports/billing-ports.ts
 * - Adapter wiring:          packages/core/src/domains/billing/adapters/billing-adapters.ts
 */
export const BILLING_STORAGE_INVARIANT_IDS = [
  'INV-BILLING-006' // 10% margin markup applied to storage overage cost
] as const
