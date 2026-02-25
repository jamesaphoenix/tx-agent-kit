import {
  invitationAssignableRoles,
  invitationStatuses,
  type InvitationAssignableRole,
  type InvitationRole,
  type InvitationStatus,
  type OrganizationOnboardingData,
  type OrgMemberRole,
  type SubscriptionStatus
} from '@tx-agent-kit/contracts'

export type {
  InvitationAssignableRole,
  InvitationRole,
  InvitationStatus,
  OrganizationOnboardingData,
  OrgMemberRole,
  SubscriptionStatus
} from '@tx-agent-kit/contracts'

export type OnboardingData = OrganizationOnboardingData

export interface OrganizationRecord {
  id: string
  name: string
  billingEmail: string | null
  onboardingData: OnboardingData | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
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
}

export interface InvitationRecord {
  id: string
  organizationId: string
  inviteeUserId: string | null
  email: string
  role: InvitationRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export interface OrganizationUserRecord {
  id: string
  email: string
  passwordHash: string
  name: string
  createdAt: Date
}

export interface Organization {
  id: string
  name: string
  billingEmail: string | null
  onboardingData: OnboardingData | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
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
}

export interface Invitation {
  id: string
  organizationId: string
  inviteeUserId: string | null
  email: string
  role: InvitationRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export interface CreateOrganizationCommand {
  name: string
}

export interface UpdateOrganizationCommand {
  name?: string
  onboardingData?: OnboardingData | null
}

export interface CreateInvitationCommand {
  organizationId: string
  email: string
  role: InvitationAssignableRole
}

export interface UpdateInvitationCommand {
  role?: InvitationAssignableRole
  status?: InvitationStatus
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const minOrganizationNameLength = 2
const maxOrganizationNameLength = 64

export const normalizeInvitationEmail = (email: string): string => email.trim().toLowerCase()

export const isValidInvitationEmail = (email: string): boolean =>
  emailPattern.test(normalizeInvitationEmail(email))

export const normalizeOrganizationName = (name: string): string => name.trim()

export const isValidOrganizationName = (name: string): boolean => {
  const trimmed = normalizeOrganizationName(name)
  return trimmed.length >= minOrganizationNameLength && trimmed.length <= maxOrganizationNameLength
}

export const canCreateInvitation = (role: OrgMemberRole): boolean => role === 'owner' || role === 'admin'
export const canManageOrganization = (role: OrgMemberRole): boolean => role === 'owner' || role === 'admin'
export const canDeleteOrganization = (role: OrgMemberRole): boolean => role === 'owner'
export const canManageInvitation = (role: OrgMemberRole): boolean => role === 'owner' || role === 'admin'

const isInvitationAssignableRole = (role: string): role is InvitationAssignableRole =>
  invitationAssignableRoles.some((value) => value === role)

const isInvitationStatus = (status: string): status is InvitationStatus =>
  invitationStatuses.some((value) => value === status)

export const isValidInvitationRoleUpdate = (
  role: string | undefined
): role is InvitationAssignableRole | undefined => role === undefined || isInvitationAssignableRole(role)

export const isValidInvitationStatusUpdate = (
  status: string | undefined
): status is InvitationStatus | undefined => status === undefined || isInvitationStatus(status)

export const toOrganization = (row: OrganizationRecord): Organization => ({
  id: row.id,
  name: row.name,
  billingEmail: row.billingEmail,
  onboardingData: row.onboardingData,
  stripeCustomerId: row.stripeCustomerId,
  stripeSubscriptionId: row.stripeSubscriptionId,
  stripePaymentMethodId: row.stripePaymentMethodId,
  creditsBalance: row.creditsBalance,
  reservedCredits: row.reservedCredits,
  autoRechargeEnabled: row.autoRechargeEnabled,
  autoRechargeThreshold: row.autoRechargeThreshold,
  autoRechargeAmount: row.autoRechargeAmount,
  isSubscribed: row.isSubscribed,
  subscriptionStatus: row.subscriptionStatus,
  subscriptionPlan: row.subscriptionPlan,
  subscriptionStartedAt: row.subscriptionStartedAt,
  subscriptionEndsAt: row.subscriptionEndsAt,
  subscriptionCurrentPeriodEnd: row.subscriptionCurrentPeriodEnd,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

export const toInvitation = (row: InvitationRecord): Invitation => ({
  id: row.id,
  organizationId: row.organizationId,
  inviteeUserId: row.inviteeUserId,
  email: row.email,
  role: row.role,
  status: row.status,
  invitedByUserId: row.invitedByUserId,
  token: row.token,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt
})
