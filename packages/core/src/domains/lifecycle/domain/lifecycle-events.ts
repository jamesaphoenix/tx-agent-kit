import type { LifecycleChurnReason } from '@tx-agent-kit/contracts'

// ---------------------------------------------------------------------------
// lifecycle.* event payloads — the public lifecycle event contract.
//
// Field sets MUST stay in sync with the effect-Schema mirrors in
// `packages/temporal-client/src/types/domain-event.ts` (the structural lint
// enforces field-name parity). Every event carries only userId (+ a few
// domain-meaningful fields). The enroll path targets the user by id; the sweep
// looks up the user's email + name fresh from the DB at send time, so the event
// never carries them.
// ---------------------------------------------------------------------------

// A brand-new user account was created (first org for a brand-new owner). Kicks
// off the welcome + onboarding sequence. Carries only the owner's userId.
export interface LifecycleSignedUpEventPayload {
  userId: string
}

// Emitted when an org begins a paid trial / activates a subscription (welcome
// credit granted). Triggers the trial-nurture drip. Carries only the org owner's
// userId, like every other lifecycle event; the sweep looks up email + name at
// send time.
export interface LifecycleTrialStartedEventPayload {
  userId: string
}

// Emitted when the org finishes the onboarding wizard (workspace profile + goals
// saved). The generic activation milestone — replaces the social-product
// account_not_connected nudge. Carries the owner's userId + the org's teamId and
// how long the org has gone without completing onboarding.
export interface LifecycleOnboardingCompletedEventPayload {
  userId: string
  teamId: string
  sinceDays: number
}

// Emitted when the org configures its first real team workspace (named team +
// invited a teammate OR first media asset uploaded). The generic "first
// meaningful action" — replaces the social-product no_first_post nudge.
export interface LifecycleWorkspaceActivatedEventPayload {
  userId: string
  teamId: string
  sinceDays: number
}

// Emitted on the org's first billable/meaningful unit of work (any usage
// recorded). Confirms real activation and ends the activation drip.
export interface LifecycleFeatureUsedEventPayload {
  userId: string
  teamId: string
  feature: string
}

// Emitted when an activated org has had no login and no usage for the inactivity
// window. Triggers re-engagement.
export interface LifecycleInactiveEventPayload {
  userId: string
  teamId: string
  inactiveDays: number
  lastActiveAt: string
}

// Emitted when the org's subscription was cancelled / lapsed. Triggers win-back.
export interface LifecycleChurnedEventPayload {
  userId: string
  reason: LifecycleChurnReason
}
