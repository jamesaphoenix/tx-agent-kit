import type {
  OrganizationRowShape,
  InvitationRowShape,
  OrgMemberRowShape,
  UserRowShape
} from '@tx-agent-kit/db'
import {
  invitationAssignableRoles,
  invitationStatuses,
  type InvitationAssignableRole,
  type InvitationStatus,
  type MembershipType,
  type OrganizationOnboardingData,
  type OrgMemberRole
} from '@tx-agent-kit/contracts'

export type {
  InvitationAssignableRole,
  InvitationRole,
  InvitationStatus,
  MembershipType,
  OrganizationOnboardingData,
  OrgMemberRole,
  SubscriptionStatus
} from '@tx-agent-kit/contracts'

export type OnboardingData = OrganizationOnboardingData

// Extends row shape — new DB columns appear automatically.
// Omit `usageCap` which is billing-only and not part of the organization domain record.
export type OrganizationRecord = Omit<OrganizationRowShape, 'usageCap'>

export type InvitationRecord = InvitationRowShape

// Extends OrgMemberRowShape with optional joined user fields.
export interface OrgMemberRecord extends OrgMemberRowShape {
  userName?: string | null
  userEmail?: string | null
}

// Subset of UserRowShape — excludes passwordChangedAt.
export type OrganizationUserRecord = Pick<UserRowShape, 'id' | 'email' | 'passwordHash' | 'name' | 'createdAt'>

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
  teamId?: string
  membershipType?: MembershipType
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

export const canCreateInvitation = (role: OrgMemberRole): boolean => role === 'admin'
export const canManageOrganization = (role: OrgMemberRole): boolean => role === 'admin'
export const canDeleteOrganization = (role: OrgMemberRole): boolean => role === 'admin'
export const canManageInvitation = (role: OrgMemberRole): boolean => role === 'admin'
export const canManageMembers = (role: OrgMemberRole): boolean => role === 'admin'

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
