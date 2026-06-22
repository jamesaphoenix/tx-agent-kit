import { campaignActivities } from '../campaign-activities.js'
import { lifecycleActivities } from './lifecycle.js'

/**
 * The lifecycle email engine's activity surface, split by Temporal task queue:
 *
 * - `lifecycleActivities` (emit signed_up/trial_started/churned + the per-team
 *   activity scan) run on the DEFAULT queue, invoked by the domain-event
 *   workflows (organizations/billing) and the daily lifecycleScanWorkflow. They
 *   are merged into `combinedActivities` (activities.ts) and registered with the
 *   default-queue worker.
 *
 * - `campaignActivities` (enroll + drip sweep + render/send + broadcast + prune)
 *   run on the EMAIL_CAMPAIGNS queue, invoked by lifecycleEnrollmentWorkflow,
 *   dripSweepWorkflow, broadcastWorkflow and pruneEmailSendsWorkflow.
 *
 * This object is the single import point that re-exports both for the registry,
 * keeping the queue assignment explicit at the worker.create call sites.
 */
export const lifecycleAndCampaignActivities = {
  ...lifecycleActivities,
  ...campaignActivities
}
