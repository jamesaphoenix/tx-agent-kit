// Public cross-domain event contract for the `lifecycle` aggregate.
// Other domains import ONLY these payload types (never internal logic).

export type {
  LifecycleSignedUpEventPayload,
  LifecycleTrialStartedEventPayload,
  LifecycleOnboardingCompletedEventPayload,
  LifecycleWorkspaceActivatedEventPayload,
  LifecycleFeatureUsedEventPayload,
  LifecycleInactiveEventPayload,
  LifecycleChurnedEventPayload
} from './domain/lifecycle-events.js'
