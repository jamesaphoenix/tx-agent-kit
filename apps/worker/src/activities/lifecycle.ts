import { activityChecks } from '@tx-agent-kit/contracts'
import type { DomainEventType, LifecycleChurnReason } from '@tx-agent-kit/contracts'
import { emitLifecycleEvent, LifecycleEventOutboxDbLive } from '@tx-agent-kit/core'
import {
  lifecycleMilestoneRepository,
  lifecycleScanRepository,
  organizationsRepository,
  systemSettingsRepository,
  type JsonObject
} from '@tx-agent-kit/db'
import { Effect, Option } from 'effect'
import { evaluateActivityCheck } from './lifecycle-scan-rules.js'
import { logger, runEffect } from './shared.js'

// The FIRST scan after the engine is activated only PRIMES: it records the
// current-state markers for every already-matching team WITHOUT emitting, so the
// engine never retroactively blasts the existing user base (a months-old org that
// already activated would otherwise receive "You are up and running"). Once this
// flag is set, the scan emits normally, so only NEW transitions fire. Stored in
// system_settings so it is once-per-database, not once-per-worker-process.
const LIFECYCLE_SCAN_PRIMED_KEY = 'lifecycle_scan_primed'

// The scan pages through every team (keyset-paginated) so it never silently caps
// at one batch. SCAN_MAX_PAGES is a runaway backstop (500k teams) far above any
// realistic install base.
const SCAN_PAGE_SIZE = 500
const SCAN_MAX_PAGES = 1000
// Per-team fan-out within a page. Each team does up to (checks) read+emit+write
// round-trips; overlapping them hides DB latency. Held at 6 to stay under the
// request pool and match the drip sweep so a concurrent sweep + scan don't
// starve connections.
const SCAN_TEAM_CONCURRENCY = 6

/**
 * Write a lifecycle.* event into the shared transactional outbox through the
 * core emit seam (LifecycleEventOutboxPort -> LifecycleEventOutboxDbLive). The
 * dispatcher then routes it to lifecycleEnrollmentWorkflow.
 */
const emitLifecycle = (
  eventType: DomainEventType,
  aggregateId: string,
  payload: JsonObject
): Promise<void> =>
  runEffect(
    emitLifecycleEvent({ eventType, aggregateId, payload }).pipe(Effect.provide(LifecycleEventOutboxDbLive))
  )

/**
 * Worker-side lifecycle event emit. Lifecycle events carry only userId (+ a few
 * domain-meaningful fields); the drip sweep looks the user's email + name up
 * fresh from the DB at send time, so no profile data flows through here.
 */
export const lifecycleActivities = {
  /**
   * Emit lifecycle.signed_up for a freshly created organization owner. Called
   * from organizationCreatedWorkflow (idempotent on the organization.created
   * event id), so it fires at most once per signup; enrollMatchingCampaigns +
   * the active-enrollment guard absorb any at-least-once retry.
   */
  emitLifecycleSignedUp: async (userId: string): Promise<void> => {
    await emitLifecycle('lifecycle.signed_up', userId, { userId })
    logger.info('Emitted lifecycle.signed_up.', { userId })
  },

  /**
   * Emit lifecycle.trial_started for an organization that was just granted its
   * welcome credit. Called from welcomeCreditGrantedWorkflow with the org owner
   * as recipient, so the trial-nurture drip enrolls the same way churn does
   * (billing event -> billing workflow -> lifecycle event -> enroll). Idempotent
   * on the billing.welcome_credit_granted event id (one welcome credit per org);
   * enrollMatchingCampaigns + the active-enrollment guard absorb any retry, and
   * email suppression/unsubscribe are still honored at enroll time.
   */
  emitLifecycleTrialStarted: async (organizationId: string): Promise<void> => {
    const org = await runEffect(organizationsRepository.getById(organizationId))
    const ownerUserId = Option.getOrUndefined(org)?.ownerUserId ?? null
    if (ownerUserId === null) {
      logger.warn('No organization owner for trial-started emit; skipping.', { organizationId })
      return
    }
    await emitLifecycle('lifecycle.trial_started', ownerUserId, { userId: ownerUserId })
    logger.info('Emitted lifecycle.trial_started.', { organizationId, userId: ownerUserId })
  },

  /**
   * Emit lifecycle.churned for an organization whose subscription was cancelled.
   * Called from subscriptionCancelledWorkflow with the org owner as recipient.
   * Churn is event-driven from Stripe (not a scan); enrollMatchingCampaigns still
   * honors email suppression/unsubscribe, so a user who opted out of email is
   * never enrolled into the win-back campaign.
   */
  emitLifecycleChurned: async (organizationId: string, reason: LifecycleChurnReason): Promise<void> => {
    const org = await runEffect(organizationsRepository.getById(organizationId))
    const ownerUserId = Option.getOrUndefined(org)?.ownerUserId ?? null
    if (ownerUserId === null) {
      logger.warn('No organization owner for churn emit; skipping.', { organizationId })
      return
    }
    await emitLifecycle('lifecycle.churned', ownerUserId, { userId: ownerUserId, reason })
    logger.info('Emitted lifecycle.churned.', { organizationId, userId: ownerUserId, reason })
  },

  /**
   * The one activity scan: page through ALL teams (keyset by created_at, id) and
   * for each, evaluate every configured activity check (missed activation
   * deadlines + inactivity + churn). A check emits only when its marker is not
   * already recorded, then records it - so each activation nudge fires at most
   * once per team and each inactivity episode once. The emit happens BEFORE the
   * marker write: a transient emit failure leaves no marker and the next scan
   * retries cleanly (a rare at-least-once double-emit is absorbed by the
   * active-enrollment guard in enrollMatchingCampaigns). The daily schedule runs
   * with SKIP overlap, so there is never a concurrent scan racing the check.
   */
  scanTeamActivity: async (): Promise<{ scanned: number; emitted: number; primed: boolean }> => {
    const now = new Date()
    // First-ever run primes (records current markers, emits nothing) so the engine
    // does not blast pre-existing teams on activation. Idempotent: the flag plus the
    // ON CONFLICT marker inserts make a re-run after a crashed prime harmless.
    const isPrime = Option.isNone(await runEffect(systemSettingsRepository.get(LIFECYCLE_SCAN_PRIMED_KEY)))
    let cursor: { createdAt: Date; teamId: string } | undefined
    let scanned = 0
    let emitted = 0

    for (let page = 0; page < SCAN_MAX_PAGES; page++) {
      const teamsActivity = await runEffect(lifecycleScanRepository.fetchTeamActivity(SCAN_PAGE_SIZE, cursor))
      if (teamsActivity.length === 0) {
        break
      }

      // Batch the "already fired?" check: one read of every existing marker for
      // this page's teams, instead of one hasTeamMilestone round-trip per
      // (team, check). The set is built once and only read inside the fan-out, so
      // it is safe to share across the concurrent team callbacks. The durable
      // guard is still tryInsertTeamMilestone's unique index; this set only avoids
      // the redundant pre-read for markers that already exist.
      const existingMarkers = new Set(
        (await runEffect(lifecycleMilestoneRepository.findTeamMarkers(teamsActivity.map((facts) => facts.teamId)))).map(
          (row) => `${row.teamId}::${row.milestone}`
        )
      )

      // Teams within a page are independent (distinct milestone markers), so fan
      // them out at a bounded concurrency via Effect.forEach. Each team's checks
      // stay sequential to preserve the emit-before-marker ordering; the per-team
      // emit count is returned and summed so there is no shared-counter race.
      const scanTeam = async (facts: (typeof teamsActivity)[number]) => {
        let teamEmitted = 0
        for (const check of activityChecks) {
          const outcome = evaluateActivityCheck(check, facts, now)
          if (!outcome.fire) {
            continue
          }
          if (existingMarkers.has(`${facts.teamId}::${outcome.marker}`)) {
            continue
          }

          // Priming records the marker WITHOUT emitting, so a pre-existing team that
          // already satisfies a check is silenced for good (its first scan is its
          // own dedup) rather than blasted. After priming, emit-before-marker holds:
          // a transient emit failure leaves no marker and the next scan retries.
          if (!isPrime) {
            await emitLifecycle(check.event, facts.teamId, outcome.payload)
          }
          await runEffect(lifecycleMilestoneRepository.tryInsertTeamMilestone(facts.teamId, outcome.marker))
          teamEmitted++
          if (!isPrime) {
            logger.info('Activity scan emitted lifecycle event.', {
              eventType: check.event,
              teamId: facts.teamId,
              userId: facts.ownerUserId
            })
          }
        }
        return teamEmitted
      }

      const pageEmits = await runEffect(
        Effect.forEach(teamsActivity, (facts) => Effect.tryPromise(() => scanTeam(facts)), {
          concurrency: SCAN_TEAM_CONCURRENCY
        })
      )
      for (const count of pageEmits) {
        emitted += count
      }

      scanned += teamsActivity.length
      const last = teamsActivity.at(-1)
      if (last === undefined || teamsActivity.length < SCAN_PAGE_SIZE) {
        break
      }
      cursor = { createdAt: last.createdAt, teamId: last.teamId }
    }

    if (isPrime) {
      // Mark the engine primed only AFTER a full pass: a crashed prime leaves the
      // flag unset, so the next scan re-primes (markers already written are kept by
      // ON CONFLICT) rather than emitting against a half-recorded marker set.
      await runEffect(
        systemSettingsRepository.upsert(
          LIFECYCLE_SCAN_PRIMED_KEY,
          { primedAt: now.toISOString(), markersRecorded: emitted },
          'First lifecycle scan recorded current-state markers without emitting, to prevent a retroactive email blast on engine activation.'
        )
      )
      logger.info('Lifecycle scan primed current-state markers (no emails sent).', { scanned, markersRecorded: emitted })
      return { scanned, emitted: 0, primed: true }
    }

    logger.info('Activity scan complete.', { scanned, emitted })
    return { scanned, emitted, primed: false }
  }
}
