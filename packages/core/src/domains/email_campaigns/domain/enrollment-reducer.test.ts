import { describe, expect, it } from 'vitest'
import {
  reduceEnrollment,
  type DripStep,
  type EnrollmentProgressState,
  type ReducerGuardsInput
} from './enrollment-reducer.js'

// step1 due at enrollment (+0s); step2 +1d after step1; step3 +3d after step2.
const steps: ReadonlyArray<DripStep> = [
  { stepOrder: 1, delaySeconds: 0 },
  { stepOrder: 2, delaySeconds: 86_400 },
  { stepOrder: 3, delaySeconds: 259_200 }
]

const now = new Date('2026-06-16T12:00:00.000Z')
const past = new Date('2026-06-16T11:00:00.000Z')
const future = new Date('2026-06-16T13:00:00.000Z')

const noGuards: ReducerGuardsInput = { suppressed: false, unsubscribed: false }

const state = (over: Partial<EnrollmentProgressState>): EnrollmentProgressState => ({
  status: 'active',
  currentStepOrder: null,
  nextStepAt: past,
  ...over
})

describe('reduceEnrollment', () => {
  it('sends step 1 when nothing has been sent yet and it is due', () => {
    const action = reduceEnrollment(state({ currentStepOrder: null, nextStepAt: past }), steps, now, noGuards)
    expect(action.kind).toBe('send')
    if (action.kind !== 'send') { return }
    expect(action.step.stepOrder).toBe(1)
    expect(action.nextState.currentStepOrder).toBe(1)
    // next due = now + step2.delaySeconds (relative to the step just sent)
    expect(action.nextState.nextStepAt?.getTime()).toBe(now.getTime() + 86_400 * 1000)
  })

  it('sends the next step mid-sequence', () => {
    const action = reduceEnrollment(state({ currentStepOrder: 1, nextStepAt: past }), steps, now, noGuards)
    expect(action.kind).toBe('send')
    if (action.kind !== 'send') { return }
    expect(action.step.stepOrder).toBe(2)
    expect(action.nextState.nextStepAt?.getTime()).toBe(now.getTime() + 259_200 * 1000)
  })

  it('sets nextStepAt null when sending the final step', () => {
    const action = reduceEnrollment(state({ currentStepOrder: 2, nextStepAt: past }), steps, now, noGuards)
    expect(action.kind).toBe('send')
    if (action.kind !== 'send') { return }
    expect(action.step.stepOrder).toBe(3)
    expect(action.nextState.nextStepAt).toBeNull()
  })

  it('completes once the last step has been sent', () => {
    const action = reduceEnrollment(state({ currentStepOrder: 3, nextStepAt: past }), steps, now, noGuards)
    expect(action).toEqual({ kind: 'complete' })
  })

  it('waits when the next step is not yet due', () => {
    const action = reduceEnrollment(state({ currentStepOrder: null, nextStepAt: future }), steps, now, noGuards)
    expect(action).toEqual({ kind: 'wait', until: future })
  })

  it('stops (suppressed) before sending', () => {
    const action = reduceEnrollment(state({}), steps, now, { suppressed: true, unsubscribed: false })
    expect(action).toEqual({ kind: 'stop', reason: 'suppressed' })
  })

  it('stops (unsubscribed) before sending', () => {
    const action = reduceEnrollment(state({}), steps, now, { suppressed: false, unsubscribed: true })
    expect(action).toEqual({ kind: 'stop', reason: 'unsubscribed' })
  })

  it('stops (paused) for a paused enrollment, ignoring due time', () => {
    const action = reduceEnrollment(state({ status: 'paused', nextStepAt: past }), steps, now, noGuards)
    expect(action).toEqual({ kind: 'stop', reason: 'paused' })
  })

  it('stops (cancelled) for cancelled and failed enrollments', () => {
    expect(reduceEnrollment(state({ status: 'cancelled' }), steps, now, noGuards)).toEqual({ kind: 'stop', reason: 'cancelled' })
    expect(reduceEnrollment(state({ status: 'failed' }), steps, now, noGuards)).toEqual({ kind: 'stop', reason: 'cancelled' })
  })

  it('handles non-contiguous step orders by positional next', () => {
    const sparse: ReadonlyArray<DripStep> = [
      { stepOrder: 1, delaySeconds: 0 },
      { stepOrder: 5, delaySeconds: 10 },
      { stepOrder: 9, delaySeconds: 20 }
    ]
    const action = reduceEnrollment(state({ currentStepOrder: 1, nextStepAt: past }), sparse, now, noGuards)
    expect(action.kind).toBe('send')
    if (action.kind !== 'send') { return }
    expect(action.step.stepOrder).toBe(5)
    expect(action.nextState.nextStepAt?.getTime()).toBe(now.getTime() + 20 * 1000)
  })

  it('is deterministic for identical inputs', () => {
    const s = state({ currentStepOrder: 1, nextStepAt: past })
    expect(reduceEnrollment(s, steps, now, noGuards)).toEqual(reduceEnrollment(s, steps, now, noGuards))
  })
})
