export { AuthService, AuthServiceLive } from './domains/auth/application/auth-service.js'
export { RoleService, RoleServiceLive } from './domains/role/application/role-service.js'
export { RoleStorePortLive } from './domains/role/adapters/role-adapters.js'
export { RoleStorePort } from './domains/role/ports/role-ports.js'
export type { RoleRecord, RoleWithPermissions } from './domains/role/domain/role-domain.js'
export { BillingService, BillingServiceLive } from './domains/billing/application/billing-service.js'
// `makeCreditService` is re-exported from the runtime layer because the
// stale-reservation reader port is pre-provided there. See
// `domains/billing/runtime/credit-reclaim-runtime.ts`.
// @spec INV-BILLING-003
export { makeCreditService } from './domains/billing/runtime/credit-reclaim-runtime.js'
export { makeStorageBillingService } from './domains/billing/application/storage-billing-service.js'
export { makeUsageCapService } from './domains/billing/application/usage-cap-service.js'
export { OrganizationMemberService, OrganizationMemberServiceLive } from './domains/organization/application/organization-member-service.js'
export { OrganizationService, OrganizationServiceLive } from './domains/organization/application/organization-service.js'
export { NotificationService, NotificationServiceLive } from './domains/notifications/application/notification-service.js'
export { NotificationStorePort } from './domains/notifications/ports/notification-ports.js'
export { NotificationStorePortLive } from './domains/notifications/adapters/notification-adapters.js'
export type {
  CreateNotificationCommand,
  ListNotificationsCommand,
  MarkReadCommand,
  NotificationEventType,
  NotificationRecord
} from './domains/notifications/domain/notification-domain.js'
export { organizationEvents, organizationEventVersions } from './domains/organization/events.js'
export { emitLifecycleEvent } from './domains/lifecycle/application/emit-lifecycle-event.js'
export { LifecycleEventOutboxPort } from './domains/lifecycle/ports/lifecycle-ports.js'
export { LifecycleEventOutboxDbLive } from './domains/lifecycle/adapters/lifecycle-adapters.js'
export type {
  LifecycleSignedUpEventPayload,
  LifecycleTrialStartedEventPayload,
  LifecycleOnboardingCompletedEventPayload,
  LifecycleWorkspaceActivatedEventPayload,
  LifecycleFeatureUsedEventPayload,
  LifecycleInactiveEventPayload,
  LifecycleChurnedEventPayload
} from './domains/lifecycle/events.js'
export type { OrganizationCreatedEventPayload, OrganizationDeletedEventPayload } from './domains/organization/events.js'
export { teamEvents, teamEventVersions } from './domains/team/events.js'
export type { TeamDeletedEventPayload } from './domains/team/events.js'
export { billingEvents, billingEventVersions } from './domains/billing/events.js'
export type {
  BillingCreditsPurchasedEventPayload,
  BillingCreditsRechargedEventPayload,
  BillingCreditsLowBalanceEventPayload,
  BillingUsageCapWarningEventPayload,
  BillingUsageCapExceededEventPayload,
  BillingPaymentFailedEventPayload,
  BillingDisputeCreatedEventPayload,
  BillingDisputeResolvedEventPayload,
  BillingSubscriptionCancelledEventPayload
} from './domains/billing/events.js'
export { ContentReviewTokenService, ContentReviewTokenServiceLive } from './domains/team/application/content-review-token-service.js'
export { TeamAuthMiddleware, TeamAuthMiddlewareLive } from './domains/team/application/team-auth-middleware.js'
export type { TeamAuthResult } from './domains/team/application/team-auth-middleware.js'
export { OrgAuthMiddleware, OrgAuthMiddlewareLive } from './domains/organization/application/org-auth-middleware.js'
export type { OrgMemberContext } from './domains/organization/application/org-auth-middleware.js'
export { TeamService, TeamServiceLive } from './domains/team/application/team-service.js'
export {
  AuthUsersPortLive,
  AuthLoginSessionPortLive,
  AuthLoginRefreshTokenPortLive,
  AuthLoginIdentityPortLive,
  AuthLoginAuditPortLive,
  AuthOrganizationMembershipPortLive,
  AuthOrganizationOwnershipPortLive,
  PasswordResetTokenPortLive,
  PasswordHasherPortLive,
  SessionTokenPortLive
} from './domains/auth/adapters/auth-adapters.js'
export {
  AutoRechargeAttemptStorePortLive,
  BillingStorePortLive,
  BillingUiPreferenceStorePortLive,
  UsageStorePortLive,
  SubscriptionEventStorePortLive,
  BillingGuardDisabledPortLive,
  ClockPortLive,
  CreditLedgerStorePortLive,
  ProcessedStripeEventStorePortLive,
  StorageUsageReaderPortLive,
  UsageCapStorePortLive
} from './domains/billing/adapters/billing-adapters.js'
export { StaleReservationReaderPort } from './domains/billing/ports/credit-reclaim-ports.js'
export type { StaleReservationRow } from './domains/billing/ports/credit-reclaim-ports.js'
export { StaleReservationReaderPortLive } from './domains/billing/runtime/credit-reclaim-runtime.js'
export {
  OrganizationMemberStorePortLive,
  OrganizationStorePortLive,
  OrganizationInvitationStorePortLive,
  OrganizationUsersPortLive
} from './domains/organization/adapters/organization-adapters.js'
export {
  ContentReviewTokenStorePortLive,
  TeamStorePortLive,
  TeamOrganizationMembershipPortLive
} from './domains/team/adapters/team-adapters.js'
export { UploadService, UploadServiceLive } from './domains/assets/application/upload-service.js'
export { MediaAssetService, MediaAssetServiceLive } from './domains/assets/application/media-asset-service.js'
export {
  AssetThumbnailService,
  AssetThumbnailServiceLive,
  type AssetThumbnailGenerationResult
} from './domains/assets/application/asset-thumbnail-service.js'
export { CollectionService, CollectionServiceLive } from './domains/assets/application/collection-service.js'
export { StorageMeteringService, StorageMeteringServiceLive, type QuotaCheckResult } from './domains/assets/application/storage-metering-service.js'
export { RetentionCleanerService, RetentionCleanerServiceLive } from './domains/assets/application/retention-cleaner-service.js'
export {
  MediaAssetStorePortLive,
  PendingUploadStorePortLive,
  StorageMeteringPortLive,
  CollectionStorePortLive,
  StorageAdapterPortLive,
  TeamLookupPortLive,
  SubscriptionLookupPortLive
} from './domains/assets/adapters/assets-adapters.js'
export {
  MediaAssetStorePort,
  PendingUploadStorePort,
  StorageMeteringPort,
  CollectionStorePort,
  StorageAdapterPort,
  ThumbnailGeneratorPort,
  TeamLookupPort,
  SubscriptionLookupPort
} from './domains/assets/ports/assets-ports.js'
export type {
  MediaAssetRecord,
  PendingUploadRecord,
  StorageMeteringRecord,
  CollectionRecord
} from './domains/assets/domain/assets-domain.js'
export { assetsEvents, assetsEventVersions } from './domains/assets/events.js'
export type { AssetsThumbnailRequestedEventPayload } from './domains/assets/events.js'
export {
  displayName,
  isProcessing,
  aspectRatio,
  validateAssetUpload
} from './domains/assets/domain/assets-domain.js'
export type {
  ValidatedUploadResult,
  UploadValidationError
} from './domains/assets/domain/assets-domain.js'
export { parseBearerToken, principalFromAuthorization } from './utils.js'
export { CoreError, UsageCapExceeded, paymentRequired } from './errors.js'
export { requireOwnership, requireRole, withInternalError } from './effect-utils.js'
export {
  AutoRechargeAttemptStorePort,
  BillingEmailPort,
  BillingGuardPort,
  BillingStorePort,
  BillingUiPreferenceStorePort,
  ClockPort,
  CreditLedgerStorePort,
  CreditServicePort,
  ProcessedStripeEventStorePort,
  StorageBillingServicePort,
  StorageUsageReaderPort,
  StripePort,
  StripeWebhookHandlerPort,
  SubscriptionEventStorePort,
  UsageCapServicePort,
  UsageCapStorePort,
  UsageStorePort
} from './domains/billing/ports/billing-ports.js'
export type { StripeWebhookEvent } from './domains/billing/ports/billing-ports.js'
export { OrganizationMemberStorePort, OrganizationStorePort } from './domains/organization/ports/organization-ports.js'
export { ContentReviewTokenStorePort } from './domains/team/ports/team-ports.js'
export {
  AuthLoginAuditPort,
  AuthLoginIdentityPort,
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  GoogleOidcPort,
  PasswordResetEmailPort,
  PasswordResetTokenPort
} from './domains/auth/ports/auth-ports.js'
export { InvitationEmailPort } from './domains/organization/ports/organization-ports.js'
export type {
  AuthPrincipal,
  AuthSession,
  AuthUser,
  CompleteGoogleAuthCommand,
  ForgotPasswordCommand,
  GoogleAuthStartResult,
  RefreshSessionCommand,
  ResetPasswordCommand,
  SignInCommand,
  SignUpCommand,
  StartGoogleAuthCommand
} from './domains/auth/domain/auth-domain.js'
export type {
  BillingSettings,
  CompleteLocalBillingSetupCommand,
  CreateCheckoutSessionCommand,
  NoCapReminderPreference,
  CreatePortalSessionCommand,
  RecordUsageCommand,
  UpdateBillingSettingsCommand,
  UsageRecord,
  UsageSummary,
  UsageSummaryCommand
} from './domains/billing/domain/billing-domain.js'
export type {
  CreateInvitationCommand,
  CreateOrganizationCommand,
  InvitationRecord,
  OrgMemberRecord,
  OrganizationRecord
} from './domains/organization/domain/organization-domain.js'
export type {
  ContentReviewTokenRecord,
  BrandSettingsShape,
  CreateTeamCommand,
  TeamRecord,
  TeamMemberRecord,
  UpdateTeamCommand
} from './domains/team/domain/team-domain.js'
export {
  isValidBrandSettings,
  isValidHexColor
} from './domains/team/domain/team-domain.js'
export { EmailCampaignService, EmailCampaignServiceLive } from './domains/email_campaigns/application/email-campaign-service.js'
export {
  CampaignStorePort,
  CampaignStepStorePort,
  EnrollmentStorePort,
  EmailSendStorePort,
  UnsubscribeStorePort,
  SuppressionStorePort,
  UserInfoLookupPort,
  EmailCampaignDomainEventOutboxPort
} from './domains/email_campaigns/ports/email-campaign-ports.js'
export {
  CampaignStorePortLive,
  CampaignStepStorePortLive,
  EnrollmentStorePortLive,
  EmailSendStorePortLive,
  UnsubscribeStorePortLive,
  SuppressionStorePortLive,
  UserInfoLookupPortLive,
  EmailCampaignDomainEventOutboxDbLive
} from './domains/email_campaigns/adapters/email-campaign-adapters.js'
export type {
  CampaignRecord,
  CampaignStepRecord,
  EnrollmentRecord,
  EmailSendRecord,
  CampaignAnalytics,
  StepAnalytics,
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignFilter,
  EmailSendTimestamps
} from './domains/email_campaigns/domain/email-campaign-domain.js'
export { reduceEnrollment } from './domains/email_campaigns/domain/enrollment-reducer.js'
export type {
  DripStep,
  EnrollmentAction,
  EnrollmentProgressState,
  EnrollmentStopReason,
  ReducerGuardsInput
} from './domains/email_campaigns/domain/enrollment-reducer.js'
export * from './pagination.js'

// ── Auto-fix (operational infra; neutral cross-cutting ports) ────────
export { AutoFixTriggerPort } from './ports/auto-fix-trigger-port.js'
export type { AutoFixTriggerError } from './ports/auto-fix-trigger-port.js'
export {
  AutoFixRunStorePort,
  AutoFixRunStoreTestPort
} from './ports/auto-fix-run-store-port.js'
export type { InsertAutoFixRunInput } from './ports/auto-fix-run-store-port.js'
export {
  AutoFixRunStoreLive,
  AutoFixRunStoreTestLive
} from './adapters/auto-fix-run-store-adapter.js'
