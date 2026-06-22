import { describe, expect, it } from 'vitest'
import type { EmailCampaignStatus, EmailSendStatus } from '@tx-agent-kit/contracts'
import {
  canActivateCampaign,
  canAdvanceEmailSendStatus,
  canModifySteps,
  getEmailSendStatusRank,
  isValidTransition
} from './email-campaign-rules.js'

// ---------------------------------------------------------------------------
// [INV-EMAIL-CAMP-004] Campaign lifecycle state machine
// ---------------------------------------------------------------------------

describe('campaign lifecycle state machine [INV-EMAIL-CAMP-004]', () => {
  const allStatuses: EmailCampaignStatus[] = ['draft', 'active', 'paused', 'archived']

  it('allows draft -> active', () => {
    expect(isValidTransition('draft', 'active')).toBe(true)
  })

  it('allows active -> paused', () => {
    expect(isValidTransition('active', 'paused')).toBe(true)
  })

  it('allows paused -> active', () => {
    expect(isValidTransition('paused', 'active')).toBe(true)
  })

  it('allows active -> archived', () => {
    expect(isValidTransition('active', 'archived')).toBe(true)
  })

  it('allows paused -> archived', () => {
    expect(isValidTransition('paused', 'archived')).toBe(true)
  })

  it('rejects draft -> paused', () => {
    expect(isValidTransition('draft', 'paused')).toBe(false)
  })

  it('rejects draft -> archived', () => {
    expect(isValidTransition('draft', 'archived')).toBe(false)
  })

  it('rejects archived -> any', () => {
    for (const to of allStatuses) {
      expect(isValidTransition('archived', to)).toBe(false)
    }
  })

  it('rejects active -> draft', () => {
    expect(isValidTransition('active', 'draft')).toBe(false)
  })

  it('rejects paused -> draft', () => {
    expect(isValidTransition('paused', 'draft')).toBe(false)
  })

  it('rejects self-transitions', () => {
    for (const status of allStatuses) {
      expect(isValidTransition(status, status)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// [INV-EMAIL-CAMP-003] Campaign activation guard
// ---------------------------------------------------------------------------

describe('canActivateCampaign [INV-EMAIL-CAMP-003]', () => {
  it('returns true when campaign has at least 1 step', () => {
    expect(canActivateCampaign(1)).toBe(true)
    expect(canActivateCampaign(5)).toBe(true)
  })

  it('returns false when campaign has zero steps', () => {
    expect(canActivateCampaign(0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// [INV-EMAIL-CAMP-002] Step modification guard
// ---------------------------------------------------------------------------

describe('canModifySteps [INV-EMAIL-CAMP-002]', () => {
  it('allows modifications in draft status', () => {
    expect(canModifySteps('draft')).toBe(true)
  })

  it('rejects modifications in non-draft statuses', () => {
    expect(canModifySteps('active')).toBe(false)
    expect(canModifySteps('paused')).toBe(false)
    expect(canModifySteps('archived')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// [INV-EMAIL-CAMP-014] Email send status monotonic rank progression
// ---------------------------------------------------------------------------

describe('email send status rank progression [INV-EMAIL-CAMP-014]', () => {
  describe('getEmailSendStatusRank', () => {
    it('assigns monotonically increasing ranks for happy-path statuses', () => {
      expect(getEmailSendStatusRank('pending')).toBe(0)
      expect(getEmailSendStatusRank('sent')).toBe(1)
      expect(getEmailSendStatusRank('delivered')).toBe(2)
      expect(getEmailSendStatusRank('opened')).toBe(3)
      expect(getEmailSendStatusRank('clicked')).toBe(4)
    })

    it('assigns terminal rank 99 to bounced, complained, and failed', () => {
      expect(getEmailSendStatusRank('bounced')).toBe(99)
      expect(getEmailSendStatusRank('complained')).toBe(99)
      expect(getEmailSendStatusRank('failed')).toBe(99)
    })
  })

  describe('canAdvanceEmailSendStatus', () => {
    it('allows forward progression: pending -> sent -> delivered -> opened -> clicked', () => {
      expect(canAdvanceEmailSendStatus('pending', 'sent')).toBe(true)
      expect(canAdvanceEmailSendStatus('sent', 'delivered')).toBe(true)
      expect(canAdvanceEmailSendStatus('delivered', 'opened')).toBe(true)
      expect(canAdvanceEmailSendStatus('opened', 'clicked')).toBe(true)
    })

    it('allows skipping intermediate statuses', () => {
      expect(canAdvanceEmailSendStatus('pending', 'delivered')).toBe(true)
      expect(canAdvanceEmailSendStatus('sent', 'opened')).toBe(true)
      expect(canAdvanceEmailSendStatus('pending', 'clicked')).toBe(true)
    })

    it('allows transition to terminal states from any non-terminal state', () => {
      const nonTerminal: EmailSendStatus[] = ['pending', 'sent', 'delivered', 'opened', 'clicked']
      const terminal: EmailSendStatus[] = ['bounced', 'complained', 'failed']

      for (const from of nonTerminal) {
        for (const to of terminal) {
          expect(canAdvanceEmailSendStatus(from, to)).toBe(true)
        }
      }
    })

    it('rejects backward progression', () => {
      expect(canAdvanceEmailSendStatus('sent', 'pending')).toBe(false)
      expect(canAdvanceEmailSendStatus('delivered', 'sent')).toBe(false)
      expect(canAdvanceEmailSendStatus('opened', 'delivered')).toBe(false)
      expect(canAdvanceEmailSendStatus('clicked', 'opened')).toBe(false)
    })

    it('rejects same-status transitions (except a failed re-stamp)', () => {
      // failed -> failed is a legitimate re-stamp of the failure reason on a
      // repeat retry, so it is excluded here and covered by the recovery test.
      const selfRejecting: EmailSendStatus[] = [
        'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained'
      ]

      for (const status of selfRejecting) {
        expect(canAdvanceEmailSendStatus(status, status)).toBe(false)
      }
    })

    it('rejects transitions out of a locked terminal state (bounced, complained)', () => {
      const locked: EmailSendStatus[] = ['bounced', 'complained']
      const allStatuses: EmailSendStatus[] = [
        'pending', 'sent', 'delivered', 'opened', 'clicked',
        'bounced', 'complained', 'failed'
      ]

      for (const from of locked) {
        for (const to of allStatuses) {
          expect(canAdvanceEmailSendStatus(from, to)).toBe(false)
        }
      }
    })

    it('treats failed as recoverable so a successful retry heals the row', () => {
      // failed is set by our own send activity on a transient error (not a
      // webhook), so a later successful retry must be able to advance it forward.
      expect(canAdvanceEmailSendStatus('failed', 'sent')).toBe(true)
      expect(canAdvanceEmailSendStatus('failed', 'delivered')).toBe(true)
      expect(canAdvanceEmailSendStatus('failed', 'opened')).toBe(true)
      expect(canAdvanceEmailSendStatus('failed', 'clicked')).toBe(true)
      // A repeat failure re-stamps; a later bounce/complaint may still terminate it.
      expect(canAdvanceEmailSendStatus('failed', 'failed')).toBe(true)
      expect(canAdvanceEmailSendStatus('failed', 'bounced')).toBe(true)
      // But it never regresses to pending.
      expect(canAdvanceEmailSendStatus('failed', 'pending')).toBe(false)
    })
  })
})
