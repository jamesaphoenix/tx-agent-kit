/**
 * Tenancy Model — cross-cutting invariants for multi-tenant isolation.
 *
 * This module exists as the colocation anchor for `tenancy-model.integration.test.ts`,
 * which verifies tenancy invariants (INV-TEN-*) across organization, team, and member
 * boundaries.
 *
 * The invariants themselves are enforced in:
 * - Domain services: packages/core/src/domains/organization/, packages/core/src/domains/team/
 * - DB repositories: packages/infra/db/src/repositories/ (tenant-scope ESLint rule)
 * - ESLint: domain-structure/enforce-tenant-scope
 *
 * @spec INV-REQ-TENANCY-MODEL-001
 * @spec INV-REQ-TENANCY-MODEL-002
 * @spec INV-REQ-TENANCY-MODEL-003
 * @spec INV-REQ-TENANCY-MODEL-004
 */
export const TENANCY_INVARIANT_IDS = [
  'INV-TEN-001', // Last-admin guard
  'INV-TEN-002', // Owner removal guard
  'INV-TEN-003', // Disabled member rejection
  'INV-TEN-004', // Tenant-scoped queries
  'INV-TEN-005', // Non-team-member rejection
  'INV-TEN-006', // Crypto-random unique tokens
  'INV-TEN-007', // Review token expiry
  'INV-TEN-008', // System role immutability
  'INV-TEN-009', // Invitation revocation audit
  'INV-TEN-009A', // Invite-before-signup email safety
] as const
