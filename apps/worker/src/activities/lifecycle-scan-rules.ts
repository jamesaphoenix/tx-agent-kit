import type { ActivityCheck } from '@tx-agent-kit/contracts'
import type { JsonObject, TeamActivityFacts } from '@tx-agent-kit/db'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What the scan should do for one (team, check) pair. `fire` means the condition
 * holds right now; the activity emits only if `marker` is not already recorded,
 * then records it, so every check fires at most once per its episode regardless
 * of scan timing or jitter. This stays pure (the activity owns the marker I/O).
 */
export interface ActivityCheckOutcome {
  readonly fire: boolean
  /** Marker key. Once-checks use a team-stable `missed:<event>` / `reached:<event>`
   * (fires once ever per team); the recurring inactivity check uses an episode key
   * `inactive:<lastActiveDay>` so a NEW inactivity episode (a newer last-active
   * date) can fire again. */
  readonly marker: string
  readonly payload: JsonObject
}

const ageDays = (createdAt: Date, now: Date): number =>
  Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS)

/** Compile-time exhaustiveness guard: a new ActivityPredicate without a switch
 * branch makes `check.predicate` no longer `never` here, which is a type error. */
const assertNever = (value: never): never => {
  throw new Error(`Unhandled activity-check predicate: ${String(value)}`)
}

/**
 * Pure evaluation of one activity check against a team's (org-projected) facts.
 *
 * Activation deadlines (`has_not_completed_onboarding`, `has_no_real_workspace`)
 * fire once the org is past the deadline with the absence still true, deduped by
 * a team-stable `missed:<event>` marker (fires once ever per team).
 *
 * The positive activation milestone (`has_recorded_usage`) is the mirror: it
 * fires the instant the org has recorded its first metered usage, deduped by a
 * team-stable `reached:<event>` marker.
 *
 * The churn check (`subscription_cancelled`) fires once the org's subscription is
 * cancelled / lapsed, deduped by a `missed:<event>` marker (once ever per team).
 *
 * The recurring inactivity check (`no_activity_since`) fires once the org has
 * been quiet for at least the threshold (no upper window - a delayed or skipped
 * scan must not permanently miss it), deduped by an episode marker keyed on the
 * last-active day so each fresh inactivity episode can fire exactly once.
 */
export const evaluateActivityCheck = (
  check: ActivityCheck,
  facts: TeamActivityFacts,
  now: Date
): ActivityCheckOutcome => {
  switch (check.predicate) {
    case 'has_not_completed_onboarding': {
      const age = ageDays(facts.createdAt, now)
      return {
        fire: !facts.onboardingCompleted && age >= check.thresholdDays,
        marker: `missed:${check.event}`,
        payload: { userId: facts.ownerUserId, teamId: facts.teamId, organizationId: facts.organizationId, sinceDays: age }
      }
    }

    case 'has_no_real_workspace': {
      const age = ageDays(facts.createdAt, now)
      return {
        fire: facts.realWorkspaceSignals === 0 && age >= check.thresholdDays,
        marker: `missed:${check.event}`,
        payload: { userId: facts.ownerUserId, teamId: facts.teamId, organizationId: facts.organizationId, sinceDays: age }
      }
    }

    case 'has_recorded_usage': {
      // Positive activation milestone (the mirror of the activation deadlines):
      // fires the instant the org has recorded its first metered usage.
      // thresholdDays is unused here (a positive milestone has no deadline) but
      // the signature stays uniform. The team-stable `reached:<event>` marker
      // makes it fire once ever per team.
      return {
        fire: facts.recordedUsage > 0,
        marker: `reached:${check.event}`,
        payload: { userId: facts.ownerUserId, teamId: facts.teamId, organizationId: facts.organizationId, feature: 'first_recorded_usage' }
      }
    }

    case 'subscription_cancelled': {
      // Churn milestone: the org's subscription is cancelled / lapsed. Fires once
      // ever per team via the `missed:<event>` marker; the win-back drip is the
      // downstream consumer.
      return {
        fire: facts.subscriptionCancelled,
        marker: `missed:${check.event}`,
        payload: { userId: facts.ownerUserId, teamId: facts.teamId, organizationId: facts.organizationId, reason: 'subscription_cancelled' }
      }
    }

    case 'no_activity_since': {
      // The org had activity, then went quiet. An org that was never active
      // (null lastActiveAt) is not "inactive" - it is covered by the
      // activation-deadline checks instead.
      const lastActive = facts.lastActiveAt
      if (lastActive === null) {
        return { fire: false, marker: 'inactive:none', payload: { userId: facts.ownerUserId, teamId: facts.teamId } }
      }
      const inactiveDays = Math.floor((now.getTime() - lastActive.getTime()) / DAY_MS)
      return {
        fire: inactiveDays >= check.thresholdDays,
        // Episode key = the day the org was last active. It stays fixed while the
        // org is quiet (fires once), and a later episode has a newer date (fires
        // again). Permanent markers, so the key must be bounded per episode.
        marker: `inactive:${lastActive.toISOString().slice(0, 10)}`,
        payload: {
          userId: facts.ownerUserId,
          teamId: facts.teamId,
          organizationId: facts.organizationId,
          inactiveDays,
          lastActiveAt: lastActive.toISOString()
        }
      }
    }

    default:
      return assertNever(check.predicate)
  }
}
