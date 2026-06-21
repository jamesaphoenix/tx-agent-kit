import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import { createLogger } from '@tx-agent-kit/logging'
import {
  addAssetToCollectionBodySchema,
  assetSearchParamsSchema,
  assetSignedUrlResponseSchema,
  assetThumbnailSignedUrlResponseSchema,
  assetsListParamsSchema,
  collectionsListParamsSchema,
  confirmUploadResponseSchema,
  createCollectionBodySchema,
  listAssetsResponseSchema,
  listCollectionAssetsResponseSchema,
  listCollectionsResponseSchema,
  mediaAssetSchema,
  uploadContentResponseSchema,
  requestUploadBodySchema,
  requestUploadResponseSchema,
  storageQuotaResponseSchema,
  storageUsageResponseSchema,
  updateAssetMetadataBodySchema,
  updateCollectionBodySchema,
  acceptInvitationResponseSchema,
  addOrgMemberRequestSchema,
  autoRechargeRequiresActionChallengeSchema,
  authPrincipalSchema,
  authResponseSchema,
  billingSettingsSchema,
  completeLocalBillingSetupSchema,
  createCheckoutSessionSchema,
  createTopUpSessionSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  createPortalSessionSchema,
  createReviewTokenRequestSchema,
  createRoleRequestSchema,
  addTeamMemberRequestSchema,
  createTeamRequestSchema,
  deletedResponseSchema,
  deleteMeResponseSchema,
  deleteObjectBodySchema,
  campaignAnalyticsResponseSchema,
  campaignListParamsSchema,
  campaignListResponseSchema,
  campaignResponseSchema,
  campaignStepResponseSchema,
  createCampaignBodySchema,
  createStepBodySchema,
  enrollmentListResponseSchema,
  enrollmentResponseSchema,
  enrollUsersBodySchema,
  enrollUsersResponseSchema,
  resendWebhookResponseSchema,
  stepAnalyticsResponseSchema,
  stepListResponseSchema,
  unsubscribeBodySchema,
  unsubscribeResponseSchema,
  unsubscribeTokenParamsSchema,
  unsubscribeVerifyResponseSchema,
  updateCampaignBodySchema,
  updateStepBodySchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  generateDownloadUrlBodySchema,
  generateUploadUrlBodySchema,
  googleAuthCallbackRequestSchema,
  googleAuthStartResponseSchema,
  healthResponseSchema,
  idsBodySchema,
  invitationSchema,
  invitationsListParamsSchema,
  invitationSummarySchema,
  listObjectsParamsSchema,
  listObjectsResponseSchema,
  listParamsSchema,
  listReviewTokensResponseSchema,
  listRolesResponseSchema,
  manyResponseSchema,
  myPermissionsResponseSchema,
  noCapReminderPreferenceSchema,
  objectMetadataResponseSchema,
  orgMemberSchema,
  orgMembersResponseSchema,
  organizationSchema,
  presignedUrlResponseSchema,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  reviewTokenSchema,
  reviewTokensListParamsSchema,
  reviewTokenValidationSchema,
  roleApiResponseSchema,
  rolePermissionMapSchema,
  rolesListParamsSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  sessionUrlResponseSchema,
  signInRequestSchema,
  signOutAllResponseSchema,
  signOutResponseSchema,
  signUpRequestSchema,
  stripeWebhookResponseSchema,
  teamApiResponseSchema,
  teamMemberSchema,
  teamMembersListParamsSchema,
  teamMembersResponseSchema,
  transferOwnershipRequestSchema,
  transferOwnershipResponseSchema,
  updateBillingSettingsSchema,
  updateInvitationRequestSchema,
  updateMemberRoleRequestSchema,
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
  updateTeamMemberRoleRequestSchema,
  updateTeamRequestSchema,
  usageQueryParamsSchema,
  usageSummarySchema,
  listOrganizationsResponseSchema,
  listInvitationsResponseSchema,
  listInvitationSummariesResponseSchema,
  listTeamsResponseSchema,
  teamsListParamsSchema,
  creditBalanceResponseSchema,
  creditEntryTypeSchema
} from '@tx-agent-kit/contracts'
import {
  causeLogContext,
  findRootCauseError,
  shouldLogEffectCause
} from '@tx-agent-kit/observability/effect-cause-summary'
import * as Schema from 'effect/Schema'
import {
  getApiRequestContext,
  markApiErrorReported
} from './observability/request-context.js'
import { captureApiMappedError } from './observability/sentry.js'

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

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  message: Schema.String
}) {}

export class PaymentRequired extends Schema.TaggedError<PaymentRequired>()('PaymentRequired', {
  message: Schema.String
}) {}

export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()('TooManyRequests', {
  message: Schema.String
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()('InternalError', {
  message: Schema.String
}) {}

const apiLogger = createLogger('tx-agent-kit-api')

type MappedCoreError = BadRequest | Unauthorized | Forbidden | PaymentRequired | NotFound | Conflict | InternalError

const isTaggedErrorLike = (
  error: unknown
): error is { _tag: string; code?: string; message?: string; cause?: unknown } =>
  typeof error === 'object' && error !== null && '_tag' in error

// UNAUTHORIZED failures whose root cause is an expected JWT/JWS condition
// (expired/invalid token) are ordinary client noise, not a server fault — they
// are logged at warn and never sent to Sentry.
const expectedUnauthorizedRootCauseTags = new Set([
  'JWTExpired',
  'JWTClaimValidationFailed',
  'JWTInvalid',
  'JWSInvalid',
  'JWSSignatureVerificationFailed'
])

const isExpectedUnauthorizedAuthFailure = (error: { code?: string; cause?: unknown }): boolean => {
  if (error.code !== 'UNAUTHORIZED') {
    return false
  }

  const context = causeLogContext(error.cause)
  const rootCauseTag = typeof context.rootCauseTag === 'string' ? context.rootCauseTag : undefined
  const rootCauseType = typeof context.rootCauseType === 'string' ? context.rootCauseType : undefined

  return (
    (rootCauseTag !== undefined && expectedUnauthorizedRootCauseTags.has(rootCauseTag)) ||
    (rootCauseType !== undefined && expectedUnauthorizedRootCauseTags.has(rootCauseType))
  )
}

// A mapping is report-worthy (error level + Sentry) when it is a 500, an
// unmapped/unknown code, or its Effect cause is itself reportable. Everything
// else is an expected client error → warn, no Sentry.
const shouldCaptureCoreErrorMapping = (
  error: { code?: string; cause?: unknown },
  expectedUnauthorizedAuthFailure = isExpectedUnauthorizedAuthFailure(error)
): boolean => {
  if (expectedUnauthorizedAuthFailure) {
    return false
  }

  return error.code === 'INTERNAL_ERROR' || error.code === undefined || shouldLogEffectCause(error.cause)
}

// PRIMARY error boundary: log each mapped CoreError exactly once (5xx/unknown →
// error + Sentry, expected 4xx → warn), enriched with the active request
// context, then mark the request so the last-resort effectCauseLoggingMiddleware
// skips it (no double-log). See middleware/effect-cause-logging.ts.
const logCoreErrorMapping = (
  error: { _tag: string; code?: string; message?: string; cause?: unknown },
  httpErrorTag: MappedCoreError['_tag']
): void => {
  const causeContext = causeLogContext(error.cause)
  const context = {
    ...getApiRequestContext(),
    tag: error._tag,
    code: error.code,
    httpErrorTag,
    message: error.message,
    ...causeContext
  }
  const expectedUnauthorizedAuthFailure = isExpectedUnauthorizedAuthFailure(error)
  const reportWorthy = shouldCaptureCoreErrorMapping(error, expectedUnauthorizedAuthFailure)
  const logMessage = typeof causeContext.rootCauseMessage === 'string'
    ? causeContext.rootCauseMessage
    : error.message ?? 'CoreError mapped to HTTP error'

  if (reportWorthy) {
    apiLogger.error(logMessage, context)
    captureApiMappedError(findRootCauseError(error.cause) ?? new Error(logMessage), context)
  } else if (expectedUnauthorizedAuthFailure) {
    // An expected token/session expiry is informational, not a warning. The
    // redacted cause chain still appears in the info log for diagnosis, but it
    // is not warn/error-level noise and is never sent to Sentry.
    apiLogger.info(logMessage, context)
  } else {
    apiLogger.warn(logMessage, context)
  }

  // This request's fault is now logged at the boundary; tell the last-resort
  // effect-cause middleware to skip it so we never double-log the same error.
  markApiErrorReported()
}

export const mapCoreError = (error: unknown): MappedCoreError => {
  if (error && typeof error === 'object' && '_tag' in error) {
    const e = error as { _tag: string; code?: string; message?: string; cause?: unknown }

    // Pass through already-mapped API error types (idempotent when double-mapped)
    switch (e._tag) {
      case 'BadRequest':
        return error as BadRequest
      case 'Unauthorized':
        return error as Unauthorized
      case 'Forbidden':
        return error as Forbidden
      case 'PaymentRequired':
        return error as PaymentRequired
      case 'NotFound':
        return error as NotFound
      case 'Conflict':
        return error as Conflict
      case 'InternalError':
        return error as InternalError
    }

    const message = e.message ?? 'Internal server error'

    switch (e.code) {
      case 'BAD_REQUEST':
        logCoreErrorMapping(e, 'BadRequest')
        return new BadRequest({ message })
      case 'UNAUTHORIZED':
        logCoreErrorMapping(e, 'Unauthorized')
        return new Unauthorized({ message })
      case 'FORBIDDEN':
        logCoreErrorMapping(e, 'Forbidden')
        return new Forbidden({ message })
      case 'PAYMENT_REQUIRED':
        logCoreErrorMapping(e, 'PaymentRequired')
        return new PaymentRequired({ message })
      case 'NOT_FOUND':
        logCoreErrorMapping(e, 'NotFound')
        return new NotFound({ message })
      case 'CONFLICT':
        logCoreErrorMapping(e, 'Conflict')
        return new Conflict({ message })
      case 'INTERNAL_ERROR':
        logCoreErrorMapping(e, 'InternalError')
        return new InternalError({ message: 'Internal server error' })
      case undefined:
      default:
        logCoreErrorMapping(e, 'InternalError')
        return new InternalError({ message: 'Internal server error' })
    }
  }

  const context = {
    ...getApiRequestContext(),
    ...causeLogContext(error)
  }
  apiLogger.error('Non-CoreError fell through to 500', context)
  captureApiMappedError(new Error('Non-CoreError fell through to 500'), context)
  markApiErrorReported()
  return new InternalError({ message: 'Internal server error' })
}

// Request-BODY decode failures are client errors, not server faults. Effect Schema
// raises a `ParseError` (and `schemaBodyJson` a `RequestError` for malformed JSON);
// both must become a 400 BadRequest and be logged at `warn` - NOT routed through
// `mapCoreError`'s default branch, which would mislabel them as a reportworthy 500
// InternalError and flood Sentry with useless Effect-internals stacks. Use this for
// manual `HttpServerRequest.schemaBodyJson(...)` decodes in handlers; the framework's
// `.handle({ payload })` path already returns a 400 automatically. Non-body errors
// still defer to `mapCoreError` so genuine faults are reported.
export const mapRequestBodyError = (error: unknown): MappedCoreError => {
  if (isTaggedErrorLike(error) && (error._tag === 'ParseError' || error._tag === 'RequestError')) {
    const detail = typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'request body validation failed'
    apiLogger.warn('Rejected malformed request body', {
      ...getApiRequestContext(),
      tag: error._tag,
      httpErrorTag: 'BadRequest',
      message: detail
    })
    markApiErrorReported()
    return new BadRequest({ message: 'Invalid request body.' })
  }
  return mapCoreError(error)
}

// --- Aliases referencing contract schemas ---

const AuthResponse = authResponseSchema
const PrincipalResponse = authPrincipalSchema
const DeleteMeResponse = deleteMeResponseSchema

const SignUpBody = signUpRequestSchema
const SignInBody = signInRequestSchema
const ForgotPasswordBody = forgotPasswordRequestSchema
const ForgotPasswordResponse = forgotPasswordResponseSchema
const ResetPasswordBody = resetPasswordRequestSchema
const ResetPasswordResponse = resetPasswordResponseSchema
const RefreshSessionBody = refreshSessionRequestSchema
const RefreshSessionResponse = refreshSessionResponseSchema
const SignOutResponse = signOutResponseSchema
const SignOutAllResponse = signOutAllResponseSchema
const GoogleAuthStartResponse = googleAuthStartResponseSchema
const GoogleAuthCallbackParams = googleAuthCallbackRequestSchema
const GoogleAuthCallbackResponse = authResponseSchema

const Organization = organizationSchema
const OrganizationsResponse = listOrganizationsResponseSchema
const OrganizationsListParams = listParamsSchema
const CreateOrganizationBody = createOrganizationRequestSchema
const UpdateOrganizationBody = updateOrganizationRequestSchema

const OrgMember = orgMemberSchema
const OrgMembersResponse = orgMembersResponseSchema
const OrgMembersListParams = listParamsSchema
const AddOrgMemberBody = addOrgMemberRequestSchema
const UpdateMemberRoleBody = updateMemberRoleRequestSchema
const TransferOwnershipBody = transferOwnershipRequestSchema
const TransferOwnershipResponse = transferOwnershipResponseSchema

const MemberIdParam = HttpApiSchema.param('memberId', Schema.String)

const InvitationSummary = invitationSummarySchema
const Invitation = invitationSchema
const InvitationsResponse = listInvitationsResponseSchema
const InvitationSummariesResponse = listInvitationSummariesResponseSchema
const InvitationsListParams = invitationsListParamsSchema
const CreateInvitationBody = createInvitationRequestSchema
const UpdateInvitationBody = updateInvitationRequestSchema
const AcceptInvitationResponse = acceptInvitationResponseSchema

const InvitationTokenParam = HttpApiSchema.param('token', Schema.String)
const InvitationIdParam = HttpApiSchema.param('invitationId', Schema.String)
const OrganizationIdParam = HttpApiSchema.param('organizationId', Schema.String)
const TeamIdParam = HttpApiSchema.param('teamId', Schema.String)

const Team = teamApiResponseSchema
const TeamsResponse = listTeamsResponseSchema
const TeamsListParams = teamsListParamsSchema
const CreateTeamBody = createTeamRequestSchema
const UpdateTeamBody = updateTeamRequestSchema

const TeamMember = teamMemberSchema
const TeamMembersResponse = teamMembersResponseSchema
const TeamMembersListParams = teamMembersListParamsSchema
const AddTeamMemberBody = addTeamMemberRequestSchema
const UpdateTeamMemberRoleBody = updateTeamMemberRoleRequestSchema
const TeamMemberIdParam = HttpApiSchema.param('memberId', Schema.String)

const IdsBody = idsBodySchema
const OrganizationsManyResponse = manyResponseSchema(organizationSchema)
const InvitationsManyResponse = manyResponseSchema(invitationSummarySchema)

const HealthResponse = healthResponseSchema

const BillingSettings = billingSettingsSchema
const UpdateBillingSettingsBody = updateBillingSettingsSchema
const CheckoutSessionBody = createCheckoutSessionSchema
const TopUpSessionBody = createTopUpSessionSchema
const PortalSessionBody = createPortalSessionSchema
const CompleteLocalBillingSetupBody = completeLocalBillingSetupSchema
const SessionUrlResponse = sessionUrlResponseSchema
const UsageQueryParams = usageQueryParamsSchema
const UsageSummaryResponse = usageSummarySchema
const NoCapReminderPreferenceResponse = noCapReminderPreferenceSchema
const AutoRechargeRequiresActionResponse = autoRechargeRequiresActionChallengeSchema
const StripeWebhookResponse = stripeWebhookResponseSchema

const CreditBalanceResponse = creditBalanceResponseSchema
const CreditHistoryItem = Schema.Struct({
  id: Schema.UUID,
  entryType: creditEntryTypeSchema,
  amountDecimillicents: Schema.Number,
  reason: Schema.String,
  referenceId: Schema.NullOr(Schema.String),
  balanceAfter: Schema.Number,
  createdAt: Schema.String
})
const CreditHistoryResponse = Schema.Struct({
  items: Schema.Array(CreditHistoryItem),
  cursor: Schema.NullOr(Schema.String),
  hasMore: Schema.Boolean
})
const CreditHistoryParams = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String)
})

const PermissionMapResponse = rolePermissionMapSchema
const MyPermissionsResponse = myPermissionsResponseSchema

const GenerateUploadUrlBody = generateUploadUrlBodySchema
const GenerateDownloadUrlBody = generateDownloadUrlBodySchema
const DeleteObjectBody = deleteObjectBodySchema
const ListObjectsParams = listObjectsParamsSchema
const PresignedUrlResponse = presignedUrlResponseSchema
const ListObjectsResponse = listObjectsResponseSchema
const ObjectMetadataResponse = objectMetadataResponseSchema
const ObjectKeyParam = HttpApiSchema.param('key', Schema.String)

// --- Assets domain aliases ---
const RequestUploadBody = requestUploadBodySchema
const RequestUploadResponse = requestUploadResponseSchema
const UploadContentResponse = uploadContentResponseSchema
const ConfirmUploadResponse = confirmUploadResponseSchema
const MediaAsset = mediaAssetSchema
const AssetsResponse = listAssetsResponseSchema
const AssetsListParams = assetsListParamsSchema
const AssetSearchParams = assetSearchParamsSchema
const AssetSignedUrlResponse = assetSignedUrlResponseSchema
const AssetThumbnailSignedUrlResponse = assetThumbnailSignedUrlResponseSchema
const UpdateAssetMetadataBody = updateAssetMetadataBodySchema
const CollectionsResponse = listCollectionsResponseSchema
const CollectionAssetsResponse = listCollectionAssetsResponseSchema
const CollectionsListParams = collectionsListParamsSchema
const CreateCollectionBody = createCollectionBodySchema
const UpdateCollectionBody = updateCollectionBodySchema
const AddAssetToCollectionBody = addAssetToCollectionBodySchema
const StorageUsageResponse = storageUsageResponseSchema
const StorageQuotaResponse = storageQuotaResponseSchema
const AssetIdParam = HttpApiSchema.param('assetId', Schema.String)
const UploadIdParam = HttpApiSchema.param('uploadId', Schema.String)
const CollectionIdParam = HttpApiSchema.param('collectionId', Schema.String)

const ReviewToken = reviewTokenSchema
const ReviewTokensResponse = listReviewTokensResponseSchema
const ReviewTokensListParams = reviewTokensListParamsSchema
const CreateReviewTokenBody = createReviewTokenRequestSchema
const ReviewTokenIdParam = HttpApiSchema.param('tokenId', Schema.String)
const ReviewTokenParam = HttpApiSchema.param('token', Schema.String)
const ReviewTokenValidationResponse = reviewTokenValidationSchema

const DeletedResponse = deletedResponseSchema

const RoleResponse = roleApiResponseSchema
const RolesResponse = listRolesResponseSchema
const RolesListParams = rolesListParamsSchema
const CreateRoleBody = createRoleRequestSchema
const UpdateRoleBody = updateRoleRequestSchema
const RoleIdParam = HttpApiSchema.param('roleId', Schema.String)

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
      .addSuccess(GoogleAuthCallbackResponse)
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
      .addSuccess(InvitationSummary)
  )
  .add(
    HttpApiEndpoint.del('removeInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(HttpApiEndpoint.post('acceptInvitation')`/v1/invitations/${InvitationTokenParam}/accept`.addSuccess(AcceptInvitationResponse))
  .add(
    HttpApiEndpoint.post('addOrgMember')`/v1/organizations/${OrganizationIdParam}/members`
      .setPayload(AddOrgMemberBody)
      .addSuccess(OrgMember, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get('listOrgMembers')`/v1/organizations/${OrganizationIdParam}/members`
      .setUrlParams(OrgMembersListParams)
      .addSuccess(OrgMembersResponse)
  )
  .add(
    HttpApiEndpoint.get('listOrgInvitations')`/v1/organizations/${OrganizationIdParam}/invitations`
      .setUrlParams(InvitationsListParams)
      .addSuccess(InvitationSummariesResponse)
  )
  .add(
    HttpApiEndpoint.patch('updateMemberRole')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}/role`
      .setPayload(UpdateMemberRoleBody)
      .addSuccess(OrgMember)
  )
  .add(
    HttpApiEndpoint.post('disableMember')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}/disable`
      .addSuccess(OrgMember)
  )
  .add(
    HttpApiEndpoint.post('enableMember')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}/enable`
      .addSuccess(OrgMember)
  )
  .add(
    HttpApiEndpoint.del('removeMember')`/v1/organizations/${OrganizationIdParam}/members/${MemberIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.post('transferOwnership')`/v1/organizations/${OrganizationIdParam}/transfer-ownership`
      .setPayload(TransferOwnershipBody)
      .addSuccess(TransferOwnershipResponse)
  )

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
  .add(
    HttpApiEndpoint.post('createReviewToken')`/v1/teams/${TeamIdParam}/review-tokens`
      .setPayload(CreateReviewTokenBody)
      .addSuccess(ReviewToken, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get('listReviewTokens')`/v1/teams/${TeamIdParam}/review-tokens`
      .setUrlParams(ReviewTokensListParams)
      .addSuccess(ReviewTokensResponse)
  )
  .add(
    HttpApiEndpoint.del('revokeReviewToken')`/v1/teams/${TeamIdParam}/review-tokens/${ReviewTokenIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('validateReviewToken')`/v1/review/${ReviewTokenParam}`
      .addSuccess(ReviewTokenValidationResponse)
  )
  .add(
    HttpApiEndpoint.get('listTeamMembers')`/v1/teams/${TeamIdParam}/members`
      .setUrlParams(TeamMembersListParams)
      .addSuccess(TeamMembersResponse)
  )
  .add(
    HttpApiEndpoint.post('addTeamMember')`/v1/teams/${TeamIdParam}/members`
      .setPayload(AddTeamMemberBody)
      .addSuccess(TeamMember, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateTeamMemberRole')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}/role`
      .setPayload(UpdateTeamMemberRoleBody)
      .addSuccess(TeamMember)
  )
  .add(
    HttpApiEndpoint.del('removeTeamMember')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.post('disableTeamMember')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}/disable`
      .addSuccess(TeamMember)
  )
  .add(
    HttpApiEndpoint.post('enableTeamMember')`/v1/teams/${TeamIdParam}/members/${TeamMemberIdParam}/enable`
      .addSuccess(TeamMember)
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
    HttpApiEndpoint.post('createTopUpSession')`/v1/billing/${OrganizationIdParam}/top-up`
      .setPayload(TopUpSessionBody)
      .addSuccess(SessionUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('completeLocalBillingSetup')`/v1/billing/${OrganizationIdParam}/dev/complete-local`
      .setPayload(CompleteLocalBillingSetupBody)
      .addSuccess(BillingSettings)
  )
  .add(
    HttpApiEndpoint.get('getUsageSummary')`/v1/organizations/${OrganizationIdParam}/usage`
      .setUrlParams(UsageQueryParams)
      .addSuccess(UsageSummaryResponse)
  )
  .add(
    HttpApiEndpoint.get('getCreditBalance')`/v1/billing/${OrganizationIdParam}/credits`
      .addSuccess(CreditBalanceResponse)
  )
  .add(
    HttpApiEndpoint.get('getCreditHistory')`/v1/billing/${OrganizationIdParam}/credits/history`
      .setUrlParams(CreditHistoryParams)
      .addSuccess(CreditHistoryResponse)
  )
  .add(
    HttpApiEndpoint.get('getNoCapReminder')`/v1/billing/${OrganizationIdParam}/no-cap-reminder`
      .addSuccess(NoCapReminderPreferenceResponse)
  )
  .add(
    HttpApiEndpoint.post('dismissNoCapReminder')`/v1/billing/${OrganizationIdParam}/no-cap-reminder/dismiss`
      .addSuccess(NoCapReminderPreferenceResponse)
  )
  .add(
    HttpApiEndpoint.get('getAutoRechargeRequiresAction')`/v1/billing/${OrganizationIdParam}/auto-recharge/requires-action`
      .addSuccess(AutoRechargeRequiresActionResponse)
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

export const StorageGroup = HttpApiGroup.make('storage')
  .add(
    HttpApiEndpoint.post('generateUploadUrl', '/v1/storage/upload-url')
      .setPayload(GenerateUploadUrlBody)
      .addSuccess(PresignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('generateDownloadUrl', '/v1/storage/download-url')
      .setPayload(GenerateDownloadUrlBody)
      .addSuccess(PresignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('deleteObject', '/v1/storage/delete')
      .setPayload(DeleteObjectBody)
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listObjects', '/v1/storage/objects')
      .setUrlParams(ListObjectsParams)
      .addSuccess(ListObjectsResponse)
  )
  .add(
    HttpApiEndpoint.get('getObjectMetadata')`/v1/storage/objects/${ObjectKeyParam}/metadata`
      .addSuccess(ObjectMetadataResponse)
  )

export const RolesGroup = HttpApiGroup.make('roles')
  .add(
    HttpApiEndpoint.get('listRoles', '/v1/roles')
      .setUrlParams(RolesListParams)
      .addSuccess(RolesResponse)
  )
  .add(
    HttpApiEndpoint.post('createRole', '/v1/roles')
      .setPayload(CreateRoleBody)
      .addSuccess(RoleResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateRole')`/v1/roles/${RoleIdParam}`
      .setPayload(UpdateRoleBody)
      .addSuccess(RoleResponse)
  )
  .add(
    HttpApiEndpoint.del('removeRole')`/v1/roles/${RoleIdParam}`
      .addSuccess(DeletedResponse)
  )

export const AssetsGroup = HttpApiGroup.make('assets')
  .add(
    HttpApiEndpoint.post('requestUpload')`/v1/teams/${TeamIdParam}/uploads/request`
      .setPayload(RequestUploadBody)
      .addSuccess(RequestUploadResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.put('uploadContent')`/v1/teams/${TeamIdParam}/uploads/${UploadIdParam}/content`
      .addSuccess(UploadContentResponse)
  )
  .add(
    HttpApiEndpoint.post('confirmUpload')`/v1/teams/${TeamIdParam}/uploads/${UploadIdParam}/confirm`
      .addSuccess(ConfirmUploadResponse)
  )
  .add(
    HttpApiEndpoint.get('listAssets')`/v1/teams/${TeamIdParam}/assets`
      .setUrlParams(AssetsListParams)
      .addSuccess(AssetsResponse)
  )
  .add(
    HttpApiEndpoint.get('getAsset')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}`
      .addSuccess(MediaAsset)
  )
  .add(
    HttpApiEndpoint.patch('updateAssetMetadata')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}`
      .setPayload(UpdateAssetMetadataBody)
      .addSuccess(MediaAsset)
  )
  .add(
    HttpApiEndpoint.del('softDeleteAsset')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}`
      .addSuccess(MediaAsset)
  )
  .add(
    HttpApiEndpoint.get('getAssetSignedUrl')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}/url`
      .addSuccess(AssetSignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.get('getAssetThumbnailSignedUrl')`/v1/teams/${TeamIdParam}/assets/${AssetIdParam}/thumbnail-url`
      .addSuccess(AssetThumbnailSignedUrlResponse)
  )
  .add(
    HttpApiEndpoint.get('searchAssets')`/v1/teams/${TeamIdParam}/assets/search`
      .setUrlParams(AssetSearchParams)
      .addSuccess(AssetsResponse)
  )
  .add(
    HttpApiEndpoint.get('listCollections')`/v1/teams/${TeamIdParam}/collections`
      .setUrlParams(CollectionsListParams)
      .addSuccess(CollectionsResponse)
  )
  .add(
    HttpApiEndpoint.post('createCollection')`/v1/teams/${TeamIdParam}/collections`
      .setPayload(CreateCollectionBody)
      .addSuccess(Schema.Struct({ id: Schema.UUID, teamId: Schema.UUID, name: Schema.String, description: Schema.NullOr(Schema.String), createdAt: Schema.String, updatedAt: Schema.String }), { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}`
      .setPayload(UpdateCollectionBody)
      .addSuccess(Schema.Struct({ id: Schema.UUID, teamId: Schema.UUID, name: Schema.String, description: Schema.NullOr(Schema.String), createdAt: Schema.String, updatedAt: Schema.String }))
  )
  .add(
    HttpApiEndpoint.del('removeCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listCollectionAssets')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}/assets`
      .setUrlParams(AssetsListParams)
      .addSuccess(CollectionAssetsResponse)
  )
  .add(
    HttpApiEndpoint.post('addAssetToCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}/assets`
      .setPayload(AddAssetToCollectionBody)
      .addSuccess(DeletedResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.del('removeAssetFromCollection')`/v1/teams/${TeamIdParam}/collections/${CollectionIdParam}/assets/${AssetIdParam}`
      .addSuccess(DeletedResponse)
  )

export const StorageMeteringGroup = HttpApiGroup.make('storagemetering')
  .add(
    HttpApiEndpoint.get('getStorageUsage')`/v1/organizations/${OrganizationIdParam}/storage/usage`
      .addSuccess(StorageUsageResponse)
  )
  .add(
    HttpApiEndpoint.get('getStorageQuota')`/v1/organizations/${OrganizationIdParam}/storage/quota`
      .addSuccess(StorageQuotaResponse)
  )

// --- Email Campaign API params (API-layer concerns) ---

const CampaignIdParam = HttpApiSchema.param('campaignId', Schema.String)
const StepIdParam = HttpApiSchema.param('stepId', Schema.String)
const EnrollmentIdParam = HttpApiSchema.param('enrollmentId', Schema.String)

// --- Email Campaign schema aliases (from contracts) ---

const CampaignResponseSchema = campaignResponseSchema
const CampaignListResponseSchema = campaignListResponseSchema
const CampaignStepResponseSchema = campaignStepResponseSchema
const StepListResponseSchema = stepListResponseSchema
const EnrollmentResponseSchema = enrollmentResponseSchema
const EnrollmentListResponseSchema = enrollmentListResponseSchema
const EnrollUsersResponseSchema = enrollUsersResponseSchema
const CampaignAnalyticsResponseSchema = campaignAnalyticsResponseSchema
const StepAnalyticsResponseSchema = stepAnalyticsResponseSchema
const CreateCampaignBody = createCampaignBodySchema
const UpdateCampaignBody = updateCampaignBodySchema
const CreateStepBody = createStepBodySchema
const UpdateStepBody = updateStepBodySchema
const EnrollUsersBody = enrollUsersBodySchema
const CampaignListParams = campaignListParamsSchema
const ResendWebhookResponseSchema = resendWebhookResponseSchema
const UnsubscribeTokenParams = unsubscribeTokenParamsSchema
const UnsubscribeVerifyResponseSchema = unsubscribeVerifyResponseSchema
const UnsubscribeBody = unsubscribeBodySchema
const UnsubscribeResponseSchema = unsubscribeResponseSchema

export const EmailCampaignsGroup = HttpApiGroup.make('emailCampaigns')
  // Campaign CRUD
  .add(
    HttpApiEndpoint.get('listCampaigns', '/v1/admin/email-campaigns')
      .setUrlParams(CampaignListParams)
      .addSuccess(CampaignListResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('createCampaign', '/v1/admin/email-campaigns')
      .setPayload(CreateCampaignBody)
      .addSuccess(CampaignResponseSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get('getCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.patch('updateCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}`
      .setPayload(UpdateCampaignBody)
      .addSuccess(CampaignResponseSchema)
  )
  // Lifecycle
  .add(
    HttpApiEndpoint.post('activateCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/activate`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('pauseCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/pause`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('resumeCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/resume`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('archiveCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/archive`
      .addSuccess(CampaignResponseSchema)
  )
  // Steps
  .add(
    HttpApiEndpoint.get('listSteps')`/v1/admin/email-campaigns/${CampaignIdParam}/steps`
      .addSuccess(StepListResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('addStep')`/v1/admin/email-campaigns/${CampaignIdParam}/steps`
      .setPayload(CreateStepBody)
      .addSuccess(CampaignStepResponseSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateStep')`/v1/admin/email-campaigns/${CampaignIdParam}/steps/${StepIdParam}`
      .setPayload(UpdateStepBody)
      .addSuccess(CampaignStepResponseSchema)
  )
  .add(
    HttpApiEndpoint.del('removeStep')`/v1/admin/email-campaigns/${CampaignIdParam}/steps/${StepIdParam}`
      .addSuccess(DeletedResponse)
  )
  // Enrollments
  .add(
    HttpApiEndpoint.get('listEnrollments')`/v1/admin/email-campaigns/${CampaignIdParam}/enrollments`
      .addSuccess(EnrollmentListResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('enrollUsers')`/v1/admin/email-campaigns/${CampaignIdParam}/enroll`
      .setPayload(EnrollUsersBody)
      .addSuccess(EnrollUsersResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('cancelEnrollment')`/v1/admin/email-campaigns/${CampaignIdParam}/enrollments/${EnrollmentIdParam}/cancel`
      .addSuccess(EnrollmentResponseSchema)
  )
  // Analytics
  .add(
    HttpApiEndpoint.get('getCampaignAnalytics')`/v1/admin/email-campaigns/${CampaignIdParam}/analytics`
      .addSuccess(CampaignAnalyticsResponseSchema)
  )
  .add(
    HttpApiEndpoint.get('getStepAnalytics')`/v1/admin/email-campaigns/${CampaignIdParam}/steps/${StepIdParam}/analytics`
      .addSuccess(StepAnalyticsResponseSchema)
  )

export const EmailWebhooksGroup = HttpApiGroup.make('emailWebhooks')
  .add(
    HttpApiEndpoint.post('resendWebhook', '/v1/webhooks/resend')
      .addSuccess(ResendWebhookResponseSchema)
  )

export const EmailUnsubscribeGroup = HttpApiGroup.make('emailUnsubscribe')
  .add(
    HttpApiEndpoint.get('getUnsubscribe', '/v1/email/unsubscribe')
      .setUrlParams(UnsubscribeTokenParams)
      .addSuccess(UnsubscribeVerifyResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('postUnsubscribe', '/v1/email/unsubscribe')
      .setPayload(UnsubscribeBody)
      .addSuccess(UnsubscribeResponseSchema)
  )

export class TxAgentApi extends HttpApi.make('tx-agent-kit')
  .addError(BadRequest, { status: 400 })
  .addError(Unauthorized, { status: 401 })
  .addError(PaymentRequired, { status: 402 })
  .addError(Forbidden, { status: 403 })
  .addError(NotFound, { status: 404 })
  .addError(Conflict, { status: 409 })
  .addError(TooManyRequests, { status: 429 })
  .addError(InternalError, { status: 500 })
  .add(HealthGroup)
  .add(AuthGroup)
  .add(OrganizationsGroup)
  .add(TeamsGroup)
  .add(BillingGroup)
  .add(PermissionsGroup)
  .add(StorageGroup)
  .add(RolesGroup)
  .add(AssetsGroup)
  .add(StorageMeteringGroup)
  .add(EmailCampaignsGroup)
  .add(EmailWebhooksGroup)
  .add(EmailUnsubscribeGroup) {}
