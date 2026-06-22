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
//
// `bounced` and `complained` are the only LOCKED terminal states: they are set
// exclusively by Resend webhooks (a real bounce / spam complaint) and must never
// be moved. `failed` shares their terminal rank as an OUTCOME, but it is set by
// our own send activity on a transient error - so unlike a bounce it must remain
// RECOVERABLE: a later retry that succeeds has to move the row failed -> sent.
// (The invariant guards against out-of-order webhooks, not against our own retry.)
// ---------------------------------------------------------------------------

const TERMINAL_RANK = 99

const statusRanks: Record<EmailSendStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: TERMINAL_RANK,
  complained: TERMINAL_RANK,
  failed: TERMINAL_RANK
}

// Truly-terminal, webhook-set statuses that can never transition out. `failed` is
// deliberately excluded so a retry can recover it (see the block comment above).
const lockedStatuses: ReadonlySet<EmailSendStatus> = new Set<EmailSendStatus>(['bounced', 'complained'])

export const getEmailSendStatusRank = (status: EmailSendStatus): number => statusRanks[status]

export const canAdvanceEmailSendStatus = (
  current: EmailSendStatus,
  next: EmailSendStatus
): boolean => {
  // A locked terminal (real bounce / complaint) can never be moved.
  if (lockedStatuses.has(current)) {
    return false
  }

  // Any non-locked status - including `failed` - can advance to a terminal status.
  if (getEmailSendStatusRank(next) === TERMINAL_RANK) {
    return true
  }

  // For forward progress, `failed` is treated as pending-equivalent (rank 0) so a
  // successful retry recovers it (failed -> sent); every other status uses its
  // natural rank. Must strictly advance.
  const currentRank = current === 'failed' ? 0 : getEmailSendStatusRank(current)
  return getEmailSendStatusRank(next) > currentRank
}
