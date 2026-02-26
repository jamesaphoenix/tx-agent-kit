import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import {
  billingSettingsSchema,
  createCheckoutSessionSchema,
  createPortalSessionSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  googleAuthStartResponseSchema,
  invitationAssignableRoles,
  invitationStatuses,
  orgMemberRoles,
  organizationOnboardingDataSchema,
  permissionActions,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  rolePermissionMapSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  signOutAllResponseSchema,
  signOutResponseSchema,
  sortOrders,
  subscriptionStatuses,
  updateBillingSettingsSchema,
  usageCategories,
  usageSummarySchema
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'

export class BadRequest extends Schema.TaggedError<BadRequest>()('BadRequest', {
  message: Schema.String
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  message: Schema.String
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()('Conflict', {
  message: Schema.String
}) {}

export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()('TooManyRequests', {
  message: Schema.String
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()('InternalError', {
  message: Schema.String
}) {}

export const mapCoreError = (error: unknown): BadRequest | Unauthorized | NotFound | Conflict | InternalError => {
  if (error && typeof error === 'object' && '_tag' in error) {
    const e = error as { _tag: string; code?: string; message?: string }
    const message = e.message ?? 'Internal server error'

    switch (e.code) {
      case 'BAD_REQUEST':
        return new BadRequest({ message })
      case 'UNAUTHORIZED':
        return new Unauthorized({ message })
      case 'NOT_FOUND':
        return new NotFound({ message })
      case 'CONFLICT':
        return new Conflict({ message })
      default:
        return new InternalError({ message: 'Internal server error' })
    }
  }

  return new InternalError({ message: 'Internal server error' })
}

const paginatedResponseSchema = <A, I, R>(itemSchema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    data: Schema.Array(itemSchema),
    total: Schema.Number,
    nextCursor: Schema.NullOr(Schema.String),
    prevCursor: Schema.NullOr(Schema.String)
  })

const AuthUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  createdAt: Schema.String
})

const AuthResponse = Schema.Struct({
  token: Schema.String,
  refreshToken: Schema.String,
  user: AuthUser
})

const PrincipalResponse = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  organizationId: Schema.optional(Schema.String),
  roles: Schema.Array(Schema.String),
  permissions: Schema.optional(Schema.Array(Schema.Literal(...permissionActions)))
})

const DeleteMeResponse = Schema.Struct({
  deleted: Schema.Boolean
})

const SignUpBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
  name: Schema.String
})

const SignInBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String
})

const ForgotPasswordBody = forgotPasswordRequestSchema

const ForgotPasswordResponse = forgotPasswordResponseSchema

const ResetPasswordBody = resetPasswordRequestSchema

const ResetPasswordResponse = resetPasswordResponseSchema

const RefreshSessionBody = refreshSessionRequestSchema

const RefreshSessionResponse = refreshSessionResponseSchema

const SignOutResponse = signOutResponseSchema

const SignOutAllResponse = signOutAllResponseSchema

const GoogleAuthStartResponse = googleAuthStartResponseSchema

const GoogleAuthCallbackParams = Schema.Struct({
  code: Schema.String,
  state: Schema.String
})

const Organization = Schema.Struct({
  id: Schema.String,
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
  subscriptionStatus: Schema.Literal(...subscriptionStatuses),
  subscriptionPlan: Schema.NullOr(Schema.String),
  subscriptionStartedAt: Schema.NullOr(Schema.String),
  subscriptionEndsAt: Schema.NullOr(Schema.String),
  subscriptionCurrentPeriodEnd: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

const OrganizationsResponse = paginatedResponseSchema(Organization)

const OrganizationsListParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Literal(...sortOrders))
})

const CreateOrganizationBody = Schema.Struct({
  name: Schema.String
})

const UpdateOrganizationBody = Schema.Struct({
  name: Schema.optional(Schema.String),
  onboardingData: Schema.optional(Schema.NullOr(organizationOnboardingDataSchema))
})

const Invitation = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  email: Schema.String,
  role: Schema.Literal(...invitationAssignableRoles),
  status: Schema.Literal(...invitationStatuses),
  invitedByUserId: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String
})

const InvitationsResponse = paginatedResponseSchema(Invitation)

const InvitationsListParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Literal(...sortOrders)),
  'filter[status]': Schema.optional(Schema.String),
  'filter[role]': Schema.optional(Schema.String)
})

const CreateInvitationBody = Schema.Struct({
  organizationId: Schema.String,
  email: Schema.String,
  role: Schema.Literal(...invitationAssignableRoles)
})

const UpdateInvitationBody = Schema.Struct({
  role: Schema.optional(Schema.Literal(...invitationAssignableRoles)),
  status: Schema.optional(Schema.Literal(...invitationStatuses))
})

const AcceptInvitationResponse = Schema.Struct({
  accepted: Schema.Boolean
})

const InvitationTokenParam = HttpApiSchema.param('token', Schema.String)
const InvitationIdParam = HttpApiSchema.param('invitationId', Schema.String)
const OrganizationIdParam = HttpApiSchema.param('organizationId', Schema.String)
const TeamIdParam = HttpApiSchema.param('teamId', Schema.String)

const Team = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  name: Schema.String,
  website: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

const TeamsResponse = paginatedResponseSchema(Team)

const TeamsListParams = Schema.Struct({
  organizationId: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Literal(...sortOrders))
})

const CreateTeamBody = Schema.Struct({
  organizationId: Schema.String,
  name: Schema.String
})

const UpdateTeamBody = Schema.Struct({
  name: Schema.optional(Schema.String)
})

const IdsBody = Schema.Struct({
  ids: Schema.Array(Schema.UUID)
})

const OrganizationsManyResponse = Schema.Struct({
  data: Schema.Array(Organization)
})

const InvitationsManyResponse = Schema.Struct({
  data: Schema.Array(Invitation)
})

const HealthResponse = Schema.Struct({
  status: Schema.Literal('healthy'),
  timestamp: Schema.String,
  service: Schema.String
})

const BillingSettings = billingSettingsSchema

const UpdateBillingSettingsBody = updateBillingSettingsSchema

const CheckoutSessionBody = createCheckoutSessionSchema

const PortalSessionBody = createPortalSessionSchema

const SessionUrlResponse = Schema.Struct({
  id: Schema.String,
  url: Schema.String
})

const UsageQueryParams = Schema.Struct({
  category: Schema.Literal(...usageCategories),
  periodStart: Schema.optional(Schema.String),
  periodEnd: Schema.optional(Schema.String)
})

const UsageSummaryResponse = usageSummarySchema

const StripeWebhookResponse = Schema.Struct({
  processed: Schema.Boolean,
  idempotent: Schema.Boolean,
  eventId: Schema.String
})

const PermissionMapResponse = rolePermissionMapSchema

const MyPermissionsResponse = Schema.Struct({
  organizationId: Schema.optional(Schema.String),
  role: Schema.optional(Schema.Literal(...orgMemberRoles)),
  permissions: Schema.Array(Schema.Literal(...permissionActions))
})

const DeletedResponse = Schema.Struct({
  deleted: Schema.Boolean
})

export const HealthGroup = HttpApiGroup.make('health')
  .add(HttpApiEndpoint.get('health', '/health').addSuccess(HealthResponse))

export const AuthGroup = HttpApiGroup.make('auth')
  .add(HttpApiEndpoint.post('signUp', '/v1/auth/sign-up').setPayload(SignUpBody).addSuccess(AuthResponse, { status: 201 }))
  .add(HttpApiEndpoint.post('signIn', '/v1/auth/sign-in').setPayload(SignInBody).addSuccess(AuthResponse))
  .add(HttpApiEndpoint.post('refreshSession', '/v1/auth/refresh').setPayload(RefreshSessionBody).addSuccess(RefreshSessionResponse))
  .add(HttpApiEndpoint.post('signOut', '/v1/auth/sign-out').addSuccess(SignOutResponse))
  .add(HttpApiEndpoint.post('signOutAll', '/v1/auth/sign-out-all').addSuccess(SignOutAllResponse))
  .add(HttpApiEndpoint.get('googleStart', '/v1/auth/google/start').addSuccess(GoogleAuthStartResponse))
  .add(
    HttpApiEndpoint.get('googleCallback', '/v1/auth/google/callback')
      .setUrlParams(GoogleAuthCallbackParams)
      .addSuccess(AuthResponse)
  )
  .add(
    HttpApiEndpoint.post('forgotPassword', '/v1/auth/forgot-password')
      .setPayload(ForgotPasswordBody)
      .addSuccess(ForgotPasswordResponse, { status: 202 })
  )
  .add(
    HttpApiEndpoint.post('resetPassword', '/v1/auth/reset-password')
      .setPayload(ResetPasswordBody)
      .addSuccess(ResetPasswordResponse)
  )
  .add(HttpApiEndpoint.get('me', '/v1/auth/me').addSuccess(PrincipalResponse))
  .add(HttpApiEndpoint.del('deleteMe', '/v1/auth/me').addSuccess(DeleteMeResponse))

export const OrganizationsGroup = HttpApiGroup.make('organizations')
  .add(
    HttpApiEndpoint.get('listOrganizations', '/v1/organizations')
      .setUrlParams(OrganizationsListParams)
      .addSuccess(OrganizationsResponse)
  )
  .add(HttpApiEndpoint.post('createOrganization', '/v1/organizations').setPayload(CreateOrganizationBody).addSuccess(Organization, { status: 201 }))
  .add(
    HttpApiEndpoint.get('getOrganization')`/v1/organizations/${OrganizationIdParam}`
      .addSuccess(Organization)
  )
  .add(
    HttpApiEndpoint.post('getManyOrganizations', '/v1/organizations/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(OrganizationsManyResponse)
  )
  .add(
    HttpApiEndpoint.patch('updateOrganization')`/v1/organizations/${OrganizationIdParam}`
      .setPayload(UpdateOrganizationBody)
      .addSuccess(Organization)
  )
  .add(
    HttpApiEndpoint.del('removeOrganization')`/v1/organizations/${OrganizationIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listInvitations', '/v1/invitations')
      .setUrlParams(InvitationsListParams)
      .addSuccess(InvitationsResponse)
  )
  .add(
    HttpApiEndpoint.get('getInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(Invitation)
  )
  .add(
    HttpApiEndpoint.post('getManyInvitations', '/v1/invitations/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(InvitationsManyResponse)
  )
  .add(HttpApiEndpoint.post('createInvitation', '/v1/invitations').setPayload(CreateInvitationBody).addSuccess(Invitation, { status: 201 }))
  .add(
    HttpApiEndpoint.patch('updateInvitation')`/v1/invitations/${InvitationIdParam}`
      .setPayload(UpdateInvitationBody)
      .addSuccess(Invitation)
  )
  .add(
    HttpApiEndpoint.del('removeInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(HttpApiEndpoint.post('acceptInvitation')`/v1/invitations/${InvitationTokenParam}/accept`.addSuccess(AcceptInvitationResponse))

export const TeamsGroup = HttpApiGroup.make('teams')
  .add(
    HttpApiEndpoint.get('listTeams', '/v1/teams')
      .setUrlParams(TeamsListParams)
      .addSuccess(TeamsResponse)
  )
  .add(HttpApiEndpoint.post('createTeam', '/v1/teams').setPayload(CreateTeamBody).addSuccess(Team, { status: 201 }))
  .add(
    HttpApiEndpoint.get('getTeam')`/v1/teams/${TeamIdParam}`
      .addSuccess(Team)
  )
  .add(
    HttpApiEndpoint.patch('updateTeam')`/v1/teams/${TeamIdParam}`
      .setPayload(UpdateTeamBody)
      .addSuccess(Team)
  )
  .add(
    HttpApiEndpoint.del('removeTeam')`/v1/teams/${TeamIdParam}`
      .addSuccess(DeletedResponse)
  )

export const BillingGroup = HttpApiGroup.make('billing')
  .add(
    HttpApiEndpoint.get('getBillingSettings')`/v1/organizations/${OrganizationIdParam}/billing`
      .addSuccess(BillingSettings)
  )
  .add(
    HttpApiEndpoint.patch('updateBillingSettings')`/v1/organizations/${OrganizationIdParam}/billing`
      .setPayload(UpdateBillingSettingsBody)
      .addSuccess(BillingSettings)
  )
  .add(
    HttpApiEndpoint.post('createCheckoutSession', '/v1/billing/checkout')
      .setPayload(CheckoutSessionBody)
      .addSuccess(SessionUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('createPortalSession', '/v1/billing/portal')
      .setPayload(PortalSessionBody)
      .addSuccess(SessionUrlResponse)
  )
  .add(
    HttpApiEndpoint.get('getUsageSummary')`/v1/organizations/${OrganizationIdParam}/usage`
      .setUrlParams(UsageQueryParams)
      .addSuccess(UsageSummaryResponse)
  )
  .add(
    HttpApiEndpoint.post('stripeWebhook', '/v1/webhooks/stripe')
      .addSuccess(StripeWebhookResponse)
  )

export const PermissionsGroup = HttpApiGroup.make('permissions')
  .add(
    HttpApiEndpoint.get('getPermissionMap', '/v1/permissions')
      .addSuccess(PermissionMapResponse)
  )
  .add(
    HttpApiEndpoint.get('getMyPermissions', '/v1/permissions/me')
      .addSuccess(MyPermissionsResponse)
  )

export class TxAgentApi extends HttpApi.make('tx-agent-kit')
  .addError(BadRequest, { status: 400 })
  .addError(Unauthorized, { status: 401 })
  .addError(NotFound, { status: 404 })
  .addError(Conflict, { status: 409 })
  .addError(TooManyRequests, { status: 429 })
  .addError(InternalError, { status: 500 })
  .add(HealthGroup)
  .add(AuthGroup)
  .add(OrganizationsGroup)
  .add(TeamsGroup)
  .add(BillingGroup)
  .add(PermissionsGroup) {}
