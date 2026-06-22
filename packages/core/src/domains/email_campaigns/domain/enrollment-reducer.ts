import type { CampaignStepRecord, EnrollmentRecord } from './email-campaign-domain.js'

/**
 * The drip state reducer — the single source of truth for what happens next to a
 * drip enrollment. It is a PURE function of (state, steps, now, guards): no IO,
 * no clock, no DB. The sweeper is the only interpreter that applies its actions.
 *
 * Generic over a minimal step shape so the reducer never constructs DB rows:
 * the DB `CampaignStepRecord` structurally satisfies `DripStep` (it has
 * `stepOrder` + `delaySeconds`), and tests pass small literals.
 */
/** Minimal step shape the reducer needs (the DB step row satisfies it). */
export type DripStep = Pick<CampaignStepRecord, 'stepOrder' | 'delaySeconds'>

/** The reduced progression state — the enrollment row holds exactly this. */
export type EnrollmentProgressState = Pick<EnrollmentRecord, 'status' | 'currentStepOrder' | 'nextStepAt'>

/** Opt-out guards evaluated before any send. */
export type ReducerGuardsInput = {
  readonly suppressed: boolean
  readonly unsubscribed: boolean
}

export type EnrollmentStopReason = 'cancelled' | 'paused' | 'suppressed' | 'unsubscribed'

export type EnrollmentAction<TStep extends DripStep> =
  | {
      readonly kind: 'send'
      readonly step: TStep
      readonly nextState: { readonly currentStepOrder: number; readonly nextStepAt: Date | null }
    }
  | { readonly kind: 'complete' }
  | { readonly kind: 'stop'; readonly reason: EnrollmentStopReason }
  | { readonly kind: 'wait'; readonly until: Date }

const MS_PER_SECOND = 1000

export const reduceEnrollment = <TStep extends DripStep>(
  state: EnrollmentProgressState,
  steps: ReadonlyArray<TStep>,
  now: Date,
  guards: ReducerGuardsInput
): EnrollmentAction<TStep> => {
  // Non-active states resolve first — these should not normally be claimed, but
  // the reducer is defensive so a race between claim and a status change is safe.
  if (state.status === 'paused') {
    return { kind: 'stop', reason: 'paused' }
  }
  if (state.status === 'cancelled' || state.status === 'failed') {
    return { kind: 'stop', reason: 'cancelled' }
  }
  if (state.status === 'completed') {
    return { kind: 'complete' }
  }

  // Active: opt-out guards stop the sequence before any send.
  if (guards.suppressed) {
    return { kind: 'stop', reason: 'suppressed' }
  }
  if (guards.unsubscribed) {
    return { kind: 'stop', reason: 'unsubscribed' }
  }

  // Positional next step: the smallest stepOrder strictly greater than current.
  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const current = state.currentStepOrder ?? Number.NEGATIVE_INFINITY
  const nextStep = ordered.find((step) => step.stepOrder > current)

  if (nextStep === undefined) {
    return { kind: 'complete' }
  }

  // Defensive: the claim only surfaces due rows, but never send before due.
  if (state.nextStepAt !== null && now.getTime() < state.nextStepAt.getTime()) {
    return { kind: 'wait', until: state.nextStepAt }
  }

  const stepAfter = ordered.find((step) => step.stepOrder > nextStep.stepOrder)
  const nextStepAt =
    stepAfter === undefined
      ? null
      : new Date(now.getTime() + stepAfter.delaySeconds * MS_PER_SECOND)

  return {
    kind: 'send',
    step: nextStep,
    nextState: { currentStepOrder: nextStep.stepOrder, nextStepAt }
  }
}
