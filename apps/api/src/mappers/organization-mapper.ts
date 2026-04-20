import type {
  InvitationStatus,
  MembershipType,
  OrganizationOnboardingData,
  OrgMemberRole,
  SubscriptionStatus
} from '@tx-agent-kit/contracts'
import type { OrgMemberRecord } from '@tx-agent-kit/core'

export const toApiOrganization = (organization: {
  id: string
  name: string
  billingEmail: string | null
  onboardingData: OrganizationOnboardingData | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
  stripeMeteredSubscriptionItemId: string | null
  creditsBalance: number
  reservedCredits: number
  autoRechargeEnabled: boolean
  autoRechargeThreshold: number | null
  autoRechargeAmount: number | null
  isSubscribed: boolean
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: string | null
  subscriptionStartedAt: Date | null
  subscriptionEndsAt: Date | null
  subscriptionCurrentPeriodEnd: Date | null
  createdAt: Date
  updatedAt: Date
}) => ({
  id: organization.id,
  name: organization.name,
  billingEmail: organization.billingEmail,
  onboardingData: organization.onboardingData,
  stripeCustomerId: organization.stripeCustomerId,
  stripeSubscriptionId: organization.stripeSubscriptionId,
  stripePaymentMethodId: organization.stripePaymentMethodId,
  stripeMeteredSubscriptionItemId: organization.stripeMeteredSubscriptionItemId,
  creditsBalance: organization.creditsBalance,
  reservedCredits: organization.reservedCredits,
  autoRechargeEnabled: organization.autoRechargeEnabled,
  autoRechargeThreshold: organization.autoRechargeThreshold,
  autoRechargeAmount: organization.autoRechargeAmount,
  isSubscribed: organization.isSubscribed,
  subscriptionStatus: organization.subscriptionStatus,
  subscriptionPlan: organization.subscriptionPlan,
  subscriptionStartedAt: organization.subscriptionStartedAt?.toISOString() ?? null,
  subscriptionEndsAt: organization.subscriptionEndsAt?.toISOString() ?? null,
  subscriptionCurrentPeriodEnd: organization.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
  createdAt: organization.createdAt.toISOString(),
  updatedAt: organization.updatedAt.toISOString()
})

export const toApiInvitationSummary = (invitation: {
  id: string
  organizationId: string
  email: string
  role: OrgMemberRole
  status: InvitationStatus
  invitedByUserId: string
  expiresAt: Date
  revokedAt: Date | null
  revokedByUserId: string | null
  teamId: string | null
  membershipType: MembershipType
  createdAt: Date
}) => ({
  id: invitation.id,
  organizationId: invitation.organizationId,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  invitedByUserId: invitation.invitedByUserId,
  expiresAt: invitation.expiresAt.toISOString(),
  revokedAt: invitation.revokedAt?.toISOString() ?? null,
  revokedByUserId: invitation.revokedByUserId,
  teamId: invitation.teamId,
  membershipType: invitation.membershipType,
  createdAt: invitation.createdAt.toISOString()
})

export const toApiInvitation = (invitation: {
  id: string
  organizationId: string
  email: string
  role: OrgMemberRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  revokedAt: Date | null
  revokedByUserId: string | null
  teamId: string | null
  membershipType: MembershipType
  createdAt: Date
}) => ({
  ...toApiInvitationSummary(invitation),
  token: invitation.token
})

export const toApiOrgMember = (member: OrgMemberRecord) => ({
  id: member.id,
  organizationId: member.organizationId,
  userId: member.userId,
  role: member.role,
  membershipType: member.membershipType,
  disabledAt: member.disabledAt?.toISOString() ?? null,
  ...(member.userName !== undefined ? { userName: member.userName ?? null } : {}),
  ...(member.userEmail !== undefined ? { userEmail: member.userEmail ?? null } : {}),
  createdAt: member.createdAt.toISOString(),
  updatedAt: member.updatedAt.toISOString()
})
