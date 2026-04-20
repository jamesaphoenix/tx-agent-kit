/**
 * Colocation anchor for `billing-storage-reconcile.integration.test.ts`.
 *
 * The nightly storage reconciliation flow is implemented across three layers:
 *
 * 1. `billingActivities.reconcileMonthlyStorageOverage` in
 *    `billing-activities.ts` — the Temporal activity that walks every org
 *    whose `storage_usage.period_end` has rolled over and calls
 *    `StorageBillingService.reconcileMonthlyOverage` per tenant.
 * 2. `storageReconcileWorkflow` in `workflows.ts` — the scheduled Temporal
 *    workflow wrapper around the activity.
 * 3. `ensureStorageReconcileSchedule` in `schedules.ts` — the worker
 *    bootstrap helper that pins the 03:00 UTC schedule.
 *
 * This file re-exports the activity under a descriptive name so the
 * integration test can drive it via a single import and so the colocation
 * lint invariant (`scripts/lint/invariants/test-contracts.mjs`) is satisfied.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 */

import { billingActivities } from './billing-activities.js'

export const reconcileMonthlyStorageOverageActivity =
  billingActivities.reconcileMonthlyStorageOverage
