import * as Schema from 'effect/Schema'
import { paginatedResponseSchema } from './common.js'
import {
  invitationAssignableRoles,
  membershipTypes,
  orgMemberRoles,
  organizationOnboardingGoals,
  organizationOnboardingStatuses,
  organizationOnboardingSteps,
  organizationOnboardingTeamSizes,
  subscriptionStatuses
} from './literals.js'
import { brandSettingsApiSchema } from './teams.js'

export const subscriptionStatusSchema = Schema.Literal(...subscriptionStatuses)

export const organizationOnboardingStepSchema = Schema.Literal(...organizationOnboardingSteps)

export const organizationOnboardingGoalSchema = Schema.Literal(...organizationOnboardingGoals)

export const organizationOnboardingTeamSizeSchema = Schema.Literal(...organizationOnboardingTeamSizes)

export const organizationOnboardingDataSchema = Schema.Struct({
  version: Schema.Literal(1),
  status: Schema.Literal(...organizationOnboardingStatuses),
  currentStep: organizationOnboardingStepSchema,
  completedSteps: Schema.Array(organizationOnboardingStepSchema),
  organizationProfile: Schema.optional(Schema.Struct({
    displayName: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))
  })),
  workspaceProfile: Schema.optional(Schema.Struct({
    teamName: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64)),
    website: Schema.NullOr(Schema.String),
    brandSettings: Schema.optional(Schema.NullOr(brandSettingsApiSchema))
  })),
  goals: Schema.optional(Schema.Struct({
    primaryGoal: organizationOnboardingGoalSchema,
    teamSize: organizationOnboardingTeamSizeSchema
  })),
  completedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export const organizationSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  billingEmail: Schema.NullOr(Schema.String),
  onboardingData: Schema.NullOr(organizationOnboardingDataSchema),
  stripeCustomerId: Schema.NullOr(Schema.String),
  stripeSubscriptionId: Schema.NullOr(Schema.String),
  stripePaymentMethodId: Schema.NullOr(Schema.String),
  stripeMeteredSubscriptionItemId: Schema.NullOr(Schema.String),
  creditsBalance: Schema.Number,
  reservedCredits: Schema.Number,
  autoRechargeEnabled: Schema.Boolean,
  autoRechargeThreshold: Schema.NullOr(Schema.Number),
  autoRechargeAmount: Schema.NullOr(Schema.Number),
  isSubscribed: Schema.Boolean,
  subscriptionStatus: subscriptionStatusSchema,
  subscriptionPlan: Schema.NullOr(Schema.String),
  subscriptionStartedAt: Schema.NullOr(Schema.String),
  subscriptionEndsAt: Schema.NullOr(Schema.String),
  subscriptionCurrentPeriodEnd: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const createOrganizationRequestSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))
})

export const updateOrganizationRequestSchema = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))),
  onboardingData: Schema.optional(Schema.NullOr(organizationOnboardingDataSchema))
})

export const listOrganizationsResponseSchema = paginatedResponseSchema(organizationSchema)

export const orgMemberSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.UUID,
  userId: Schema.UUID,
  role: Schema.Literal(...orgMemberRoles),
  membershipType: Schema.Literal(...membershipTypes),
  disabledAt: Schema.NullOr(Schema.String),
  userName: Schema.optional(Schema.NullOr(Schema.String)),
  userEmail: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const orgMembersResponseSchema = paginatedResponseSchema(orgMemberSchema)

export const updateMemberRoleRequestSchema = Schema.Struct({
  role: Schema.Literal(...invitationAssignableRoles)
})

export const addOrgMemberRequestSchema = Schema.Struct({
  userId: Schema.UUID,
  role: Schema.optional(Schema.Literal(...invitationAssignableRoles))
})

export const transferOwnershipRequestSchema = Schema.Struct({
  newOwnerUserId: Schema.UUID
})

export type OrgMember = Schema.Schema.Type<typeof orgMemberSchema>
export type AddOrgMemberRequest = Schema.Schema.Type<typeof addOrgMemberRequestSchema>
export type UpdateMemberRoleRequest = Schema.Schema.Type<typeof updateMemberRoleRequestSchema>
export type TransferOwnershipRequest = Schema.Schema.Type<typeof transferOwnershipRequestSchema>

export type Organization = Schema.Schema.Type<typeof organizationSchema>
export type OrganizationOnboardingData = Schema.Schema.Type<typeof organizationOnboardingDataSchema>
export type OrganizationOnboardingStep = Schema.Schema.Type<typeof organizationOnboardingStepSchema>
export type OrganizationOnboardingGoal = Schema.Schema.Type<typeof organizationOnboardingGoalSchema>
export type OrganizationOnboardingTeamSize = Schema.Schema.Type<typeof organizationOnboardingTeamSizeSchema>
export const transferOwnershipResponseSchema = Schema.Struct({
  transferred: Schema.Boolean
})

export type CreateOrganizationRequest = Schema.Schema.Type<typeof createOrganizationRequestSchema>
export type UpdateOrganizationRequest = Schema.Schema.Type<typeof updateOrganizationRequestSchema>
export type TransferOwnershipResponse = Schema.Schema.Type<typeof transferOwnershipResponseSchema>
