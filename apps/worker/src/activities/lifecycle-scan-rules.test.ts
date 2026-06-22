import type { ActivityCheck } from '@tx-agent-kit/contracts'
import type { TeamActivityFacts } from '@tx-agent-kit/db'
import { describe, expect, it } from 'vitest'
import { evaluateActivityCheck } from './lifecycle-scan-rules.js'

const NOW = new Date('2026-06-22T00:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

const baseFacts = (overrides: Partial<TeamActivityFacts> = {}): TeamActivityFacts => ({
  teamId: 'team-1',
  organizationId: 'org-1',
  ownerUserId: 'user-1',
  createdAt: daysAgo(10),
  onboardingCompleted: false,
  realWorkspaceSignals: 0,
  recordedUsage: 0,
  subscriptionCancelled: false,
  lastActiveAt: null,
  ...overrides
})

const onboardingCheck: ActivityCheck = { event: 'lifecycle.onboarding_completed', thresholdDays: 0, predicate: 'has_not_completed_onboarding', once: true }
const workspaceCheck: ActivityCheck = { event: 'lifecycle.workspace_activated', thresholdDays: 0, predicate: 'has_no_real_workspace', once: true }
const usageCheck: ActivityCheck = { event: 'lifecycle.feature_used', thresholdDays: 0, predicate: 'has_recorded_usage', once: true }
const inactiveCheck: ActivityCheck = { event: 'lifecycle.inactive', thresholdDays: 21, predicate: 'no_activity_since', once: false }
const churnCheck: ActivityCheck = { event: 'lifecycle.churned', thresholdDays: 0, predicate: 'subscription_cancelled', once: true }

describe('evaluateActivityCheck', () => {
  it('fires has_not_completed_onboarding past the deadline with onboarding incomplete', () => {
    const outcome = evaluateActivityCheck(onboardingCheck, baseFacts({ onboardingCompleted: false }), NOW)
    expect(outcome.fire).toBe(true)
    expect(outcome.marker).toBe('missed:lifecycle.onboarding_completed')
    expect(outcome.payload).toMatchObject({ userId: 'user-1', teamId: 'team-1', organizationId: 'org-1' })
  })

  it('does not fire onboarding when already completed', () => {
    const outcome = evaluateActivityCheck(onboardingCheck, baseFacts({ onboardingCompleted: true }), NOW)
    expect(outcome.fire).toBe(false)
  })

  it('fires has_no_real_workspace when there are no workspace signals', () => {
    const outcome = evaluateActivityCheck(workspaceCheck, baseFacts({ realWorkspaceSignals: 0 }), NOW)
    expect(outcome.fire).toBe(true)
    expect(outcome.marker).toBe('missed:lifecycle.workspace_activated')
  })

  it('does not fire has_no_real_workspace once there is a workspace signal', () => {
    const outcome = evaluateActivityCheck(workspaceCheck, baseFacts({ realWorkspaceSignals: 1 }), NOW)
    expect(outcome.fire).toBe(false)
  })

  it('fires has_recorded_usage (positive milestone) on first recorded usage', () => {
    const outcome = evaluateActivityCheck(usageCheck, baseFacts({ recordedUsage: 3 }), NOW)
    expect(outcome.fire).toBe(true)
    expect(outcome.marker).toBe('reached:lifecycle.feature_used')
    expect(outcome.payload).toMatchObject({ feature: 'first_recorded_usage' })
  })

  it('does not fire has_recorded_usage when there is no usage', () => {
    const outcome = evaluateActivityCheck(usageCheck, baseFacts({ recordedUsage: 0 }), NOW)
    expect(outcome.fire).toBe(false)
  })

  it('fires subscription_cancelled when the subscription has lapsed', () => {
    const outcome = evaluateActivityCheck(churnCheck, baseFacts({ subscriptionCancelled: true }), NOW)
    expect(outcome.fire).toBe(true)
    expect(outcome.marker).toBe('missed:lifecycle.churned')
    expect(outcome.payload).toMatchObject({ reason: 'subscription_cancelled' })
  })

  describe('no_activity_since', () => {
    it('does not fire for a never-active team', () => {
      const outcome = evaluateActivityCheck(inactiveCheck, baseFacts({ lastActiveAt: null }), NOW)
      expect(outcome.fire).toBe(false)
      expect(outcome.marker).toBe('inactive:none')
    })

    it('fires once the inactivity window is exceeded, keyed by the last-active day', () => {
      const outcome = evaluateActivityCheck(inactiveCheck, baseFacts({ lastActiveAt: daysAgo(30) }), NOW)
      expect(outcome.fire).toBe(true)
      expect(outcome.marker).toBe('inactive:2026-05-23')
      expect(outcome.payload).toMatchObject({ inactiveDays: 30 })
    })

    it('does not fire while still inside the window', () => {
      const outcome = evaluateActivityCheck(inactiveCheck, baseFacts({ lastActiveAt: daysAgo(5) }), NOW)
      expect(outcome.fire).toBe(false)
    })

    it('keys a NEW inactivity episode by a newer last-active day so it can fire again', () => {
      const first = evaluateActivityCheck(inactiveCheck, baseFacts({ lastActiveAt: daysAgo(30) }), NOW)
      const second = evaluateActivityCheck(inactiveCheck, baseFacts({ lastActiveAt: daysAgo(25) }), NOW)
      expect(first.marker).not.toBe(second.marker)
    })
  })
})
