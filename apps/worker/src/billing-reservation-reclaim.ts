/**
 * Colocation anchor for `billing-reservation-reclaim.integration.test.ts`.
 *
 * The orphan-reservation reclaim flow is implemented across three layers:
 *
 * 1. `billingActivities.releaseStaleReservations` in `billing-activities.ts`
 *    — the Temporal activity that scans + releases stale reservations.
 * 2. `releaseStaleReservationsWorkflow` in `workflows.ts` — the scheduled
 *    Temporal workflow wrapper around the activity.
 * 3. `ensureReleaseStaleReservationsSchedule` in `schedules.ts` — the worker
 *    bootstrap helper that pins the schedule.
 *
 * This file re-exports the activity under a descriptive name so the
 * integration test can drive it via a single import and so the colocation
 * lint invariant (`scripts/lint/invariants/test-contracts.mjs`) is satisfied.
 *
 * @spec INV-BILLING-003 — reservation lifecycle.
 */

import { billingActivities } from './billing-activities.js'

export const releaseStaleReservationsActivity = billingActivities.releaseStaleReservations
