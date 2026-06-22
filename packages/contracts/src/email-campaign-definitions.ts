import * as Schema from 'effect/Schema'
import {
  audiencePredicates,
  campaignDefinitionStatuses,
  lifecycleEventTypes,
  lifecycleTemplateIds,
  type ActivityPredicate,
  type AudiencePredicate,
  type CampaignDefinitionStatus,
  type LifecycleEventType,
  type LifecycleTemplateId
} from './literals.js'

// Template ids, audience/activity predicates, and definition statuses are the
// SINGLE SOURCE OF TRUTH in literals.ts (centralization rule); imported here and
// re-exported via the contracts barrel.

export type CampaignAudienceFilter = { readonly type: AudiencePredicate }

// ---------------------------------------------------------------------------
// Campaign definition (config-as-code, plain serializable data)
// ---------------------------------------------------------------------------

// eventType is constrained to a LIFECYCLE event, not any domain event: only
// lifecycle.* events route to lifecycleEnrollmentWorkflow -> enrollMatchingCampaigns
// (resolve-dispatch.ts). A campaign triggered on a billing/social/etc. event would
// be synced active but silently never enroll, so non-lifecycle triggers are a
// compile + decode error. Bridge other events to a lifecycle event (e.g.
// welcomeCreditGrantedWorkflow -> lifecycle.trial_started, churn -> lifecycle.churned).
export type CampaignDefinitionTrigger = {
  readonly type: 'domain_event'
  readonly eventType: LifecycleEventType
}

export type CampaignDefinitionStep = {
  readonly stepOrder: number
  readonly subject: string
  readonly templateId: LifecycleTemplateId
  readonly templateData?: Record<string, unknown>
  /** Delay (seconds) from the previous step's send to this step becoming due. */
  readonly delaySeconds: number
}

export type CampaignDefinition = {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly campaignType: 'drip_sequence'
  readonly status: CampaignDefinitionStatus
  readonly trigger: CampaignDefinitionTrigger
  readonly audienceFilter?: CampaignAudienceFilter
  readonly steps: ReadonlyArray<CampaignDefinitionStep>
}

const DAY = 86_400

/**
 * The launch lifecycle campaigns. Synced idempotently into email_campaigns by
 * slug; steps reconcile by positional stepOrder. delaySeconds is relative to the
 * previous step (step 1 is relative to enrollment).
 */
export const campaignDefinitions: ReadonlyArray<CampaignDefinition> = [
  {
    slug: 'onboarding-activation',
    name: 'Onboarding & Activation Drip',
    campaignType: 'drip_sequence',
    status: 'active',
    trigger: { type: 'domain_event', eventType: 'lifecycle.signed_up' },
    steps: [
      { stepOrder: 1, subject: 'Welcome to tx-agent-kit', templateId: 'lifecycle/welcome', delaySeconds: 0, templateData: { ctaSurface: 'dashboard' } },
      { stepOrder: 2, subject: 'Finish setting up your organization', templateId: 'lifecycle/complete-onboarding', delaySeconds: 1 * DAY, templateData: { ctaSurface: 'onboarding' } },
      { stepOrder: 3, subject: 'Create your first workspace', templateId: 'lifecycle/create-workspace', delaySeconds: 2 * DAY, templateData: { ctaSurface: 'org' } },
      { stepOrder: 4, subject: 'Bring your team along', templateId: 'lifecycle/invite-teammate', delaySeconds: 2 * DAY, templateData: { ctaSurface: 'invitations' } },
      { stepOrder: 5, subject: '3 tips to get value from tx-agent-kit fast', templateId: 'lifecycle/activation-tips', delaySeconds: 3 * DAY, templateData: { ctaSurface: 'dashboard' } }
    ]
  },
  {
    slug: 'first-asset-nudge',
    name: 'First Asset / First Action Nudge',
    campaignType: 'drip_sequence',
    status: 'active',
    trigger: { type: 'domain_event', eventType: 'lifecycle.onboarding_completed' },
    steps: [
      { stepOrder: 1, subject: 'Upload your first asset to get started', templateId: 'lifecycle/upload-first-asset', delaySeconds: 2 * DAY, templateData: { ctaSurface: 'org' } },
      { stepOrder: 2, subject: 'Here is what teams build first', templateId: 'lifecycle/feature-spotlight-credits', delaySeconds: 3 * DAY, templateData: { ctaSurface: 'dashboard' } }
    ]
  },
  {
    slug: 'trial-nurture',
    name: 'Trial Nurture',
    campaignType: 'drip_sequence',
    status: 'active',
    // The trial start is a billing event; the worker bridges it to
    // lifecycle.trial_started (mirroring the churn bridge) because only
    // lifecycle.* events reach enrollMatchingCampaigns. Triggering directly on
    // the raw billing event would silently never enroll.
    trigger: { type: 'domain_event', eventType: 'lifecycle.trial_started' },
    steps: [
      { stepOrder: 1, subject: 'Making the most of your trial', templateId: 'lifecycle/trial-getting-started', delaySeconds: 1 * DAY, templateData: { ctaSurface: 'dashboard' } },
      { stepOrder: 2, subject: 'Your trial is ending soon', templateId: 'lifecycle/trial-ending-soon', delaySeconds: 10 * DAY, templateData: { ctaSurface: 'pricing' } }
    ]
  },
  {
    slug: 'reengagement',
    name: 'Re-engagement',
    campaignType: 'drip_sequence',
    status: 'active',
    trigger: { type: 'domain_event', eventType: 'lifecycle.inactive' },
    steps: [
      { stepOrder: 1, subject: 'Your workspace is waiting', templateId: 'lifecycle/inactive-nudge', delaySeconds: 0, templateData: { ctaSurface: 'dashboard' } },
      { stepOrder: 2, subject: 'Anything we can help with?', templateId: 'lifecycle/inactive-final', delaySeconds: 7 * DAY, templateData: { ctaSurface: 'dashboard' } }
    ]
  },
  {
    slug: 'winback',
    name: 'Win-back',
    campaignType: 'drip_sequence',
    status: 'active',
    trigger: { type: 'domain_event', eventType: 'lifecycle.churned' },
    steps: [
      { stepOrder: 1, subject: 'We saved your workspace', templateId: 'lifecycle/we-miss-you', delaySeconds: 3 * DAY, templateData: { ctaSurface: 'pricing' } },
      { stepOrder: 2, subject: 'Come back and pick up where you left off', templateId: 'lifecycle/churned-winback', delaySeconds: 11 * DAY, templateData: { ctaSurface: 'pricing' } },
      { stepOrder: 3, subject: 'One question before you go', templateId: 'lifecycle/churned-feedback', delaySeconds: 7 * DAY, templateData: { ctaSurface: 'dashboard' } }
    ]
  },
  {
    slug: 'usage-milestone',
    name: 'Activation Milestone Celebration',
    campaignType: 'drip_sequence',
    status: 'active',
    trigger: { type: 'domain_event', eventType: 'lifecycle.feature_used' },
    steps: [
      { stepOrder: 1, subject: 'You are up and running', templateId: 'lifecycle/usage-milestone', delaySeconds: 0, templateData: { ctaSurface: 'dashboard' } },
      { stepOrder: 2, subject: 'How is tx-agent-kit working for you?', templateId: 'lifecycle/feedback-request', delaySeconds: 14 * DAY, templateData: { ctaSurface: 'dashboard' } }
    ]
  }
]

// ---------------------------------------------------------------------------
// Activity scan checks (one per-team scan emits these activity-derived events)
// ---------------------------------------------------------------------------

export type ActivityCheck = {
  readonly event: LifecycleEventType
  readonly thresholdDays: number
  readonly predicate: ActivityPredicate
  /** once=true => fires at most once per team (marker-deduped); false => recurring/windowed. */
  readonly once: boolean
}

export const activityChecks: ReadonlyArray<ActivityCheck> = [
  { event: 'lifecycle.onboarding_completed', thresholdDays: 0, predicate: 'has_not_completed_onboarding', once: true },
  { event: 'lifecycle.workspace_activated', thresholdDays: 0, predicate: 'has_no_real_workspace', once: true },
  // Positive "first recorded usage" milestone: activates the usage-milestone campaign.
  { event: 'lifecycle.feature_used', thresholdDays: 0, predicate: 'has_recorded_usage', once: true },
  { event: 'lifecycle.inactive', thresholdDays: 21, predicate: 'no_activity_since', once: false },
  { event: 'lifecycle.churned', thresholdDays: 0, predicate: 'subscription_cancelled', once: true }
]

// ---------------------------------------------------------------------------
// Runtime validation schema (CI test decodes campaignDefinitions against this)
// ---------------------------------------------------------------------------

export const campaignDefinitionStepSchema = Schema.Struct({
  stepOrder: Schema.Number,
  subject: Schema.String,
  templateId: Schema.Literal(...lifecycleTemplateIds),
  templateData: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  delaySeconds: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0))
})

export const campaignDefinitionSchema = Schema.Struct({
  slug: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optional(Schema.String),
  campaignType: Schema.Literal('drip_sequence'),
  status: Schema.Literal(...campaignDefinitionStatuses),
  // eventType is strongly typed to a registered LIFECYCLE event (not a free
  // string, and not any domain event), so a typo, a removed event, or a
  // non-enrolling trigger (e.g. a raw billing event) is a decode failure rather
  // than a campaign that silently never enrolls.
  trigger: Schema.Struct({ type: Schema.Literal('domain_event'), eventType: Schema.Literal(...lifecycleEventTypes) }),
  audienceFilter: Schema.optional(Schema.Struct({ type: Schema.Literal(...audiencePredicates) })),
  steps: Schema.Array(campaignDefinitionStepSchema).pipe(Schema.minItems(1))
})
