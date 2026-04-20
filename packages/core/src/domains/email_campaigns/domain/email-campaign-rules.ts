import type { EmailCampaignStatus, EmailSendStatus } from '@tx-agent-kit/contracts'

// ---------------------------------------------------------------------------
// Campaign lifecycle state machine [INV-EMAIL-CAMP-004]
// Valid transitions: draft->active, active->paused, paused->active,
//                    active->archived, paused->archived
// ---------------------------------------------------------------------------

const validTransitions: ReadonlyMap<EmailCampaignStatus, ReadonlySet<EmailCampaignStatus>> = new Map([
  ['draft', new Set<EmailCampaignStatus>(['active'])],
  ['active', new Set<EmailCampaignStatus>(['paused', 'archived'])],
  ['paused', new Set<EmailCampaignStatus>(['active', 'archived'])],
  ['archived', new Set<EmailCampaignStatus>([])]
])

export const isValidTransition = (from: EmailCampaignStatus, to: EmailCampaignStatus): boolean => {
  const allowed = validTransitions.get(from)
  return allowed?.has(to) ?? false
}

// ---------------------------------------------------------------------------
// Campaign activation guard [INV-EMAIL-CAMP-003]
// A campaign must have at least one step to be activated.
// ---------------------------------------------------------------------------

export const canActivateCampaign = (stepCount: number): boolean => stepCount >= 1

// ---------------------------------------------------------------------------
// Step modification guard [INV-EMAIL-CAMP-002]
// Only campaigns in 'draft' status allow structural changes (add/remove/reorder steps).
// ---------------------------------------------------------------------------

export const canModifySteps = (campaignStatus: EmailCampaignStatus): boolean =>
  campaignStatus === 'draft'

// ---------------------------------------------------------------------------
// Email send status monotonic rank progression [INV-EMAIL-CAMP-014]
// Status updates only advance rank. Out-of-order webhooks cannot regress status.
// Bounced, complained, and failed are terminal states.
// ---------------------------------------------------------------------------

const statusRanks: Record<EmailSendStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 99,
  complained: 99,
  failed: 99
}

export const getEmailSendStatusRank = (status: EmailSendStatus): number => statusRanks[status]

export const canAdvanceEmailSendStatus = (
  current: EmailSendStatus,
  next: EmailSendStatus
): boolean => {
  const currentRank = getEmailSendStatusRank(current)
  const nextRank = getEmailSendStatusRank(next)

  // Cannot move away from a terminal state (bounced, complained, failed)
  if (currentRank === 99) {
    return false
  }

  // Any non-terminal status can advance to a terminal status
  if (nextRank === 99) {
    return true
  }

  // For non-terminal transitions, must strictly advance
  return nextRank > currentRank
}
