import { HttpApiBuilder, HttpApiSwagger } from '@effect/platform'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import {
  AuthServiceLive,
  AuthLoginAuditPortLive,
  AuthLoginIdentityPortLive,
  AuthLoginRefreshTokenPortLive,
  AuthLoginSessionPortLive,
  AuthUsersPortLive,
  AuthOrganizationMembershipPortLive,
  AuthOrganizationOwnershipPortLive,
  AutoRechargeAttemptStorePortLive,
  BillingGuardPort,
  BillingUiPreferenceStorePortLive,
  BillingServiceLive,
  BillingStorePortLive,
  ClockPortLive,
  PasswordResetTokenPortLive,
  PasswordHasherPortLive,
  SessionTokenPortLive,
  OrganizationInvitationStorePortLive,
  OrganizationMemberServiceLive,
  OrganizationMemberStorePortLive,
  OrganizationServiceLive,
  OrganizationStorePortLive,
  OrganizationUsersPortLive,
  RoleServiceLive,
  RoleStorePortLive,
  SubscriptionEventStorePortLive,
  ContentReviewTokenStorePortLive,
  TeamAuthMiddlewareLive,
  OrgAuthMiddlewareLive,
  TeamServiceLive,
  TeamStorePortLive,
  TeamOrganizationMembershipPortLive,
  UsageStorePortLive,
  EmailCampaignServiceLive,
  CampaignStorePortLive,
  CampaignStepStorePortLive,
  EnrollmentStorePortLive,
  EmailSendStorePortLive,
  UnsubscribeStorePortLive,
  SuppressionStorePortLive,
  UploadServiceLive,
  MediaAssetServiceLive,
  CollectionServiceLive,
  StorageMeteringServiceLive,
  MediaAssetStorePortLive,
  PendingUploadStorePortLive,
  StorageMeteringPortLive,
  CollectionStorePortLive,
  StorageAdapterPortLive,
  TeamLookupPortLive,
  SubscriptionLookupPortLive,
  CreditLedgerStorePortLive,
  ProcessedStripeEventStorePortLive,
  CreditServicePort,
  makeCreditService,
  makeStorageBillingService,
  StorageBillingServicePort,
  StorageUsageReaderPortLive,
  UsageCapServicePort,
  UsageCapStorePortLive,
  makeUsageCapService,
  AutoFixRunStoreLive,
  AutoFixRunStoreTestLive
} from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { closeRedisClients } from '@tx-agent-kit/redis'
import { flushApiSentry, initializeApiSentry } from './observability/sentry.js'
import { Effect, Layer } from 'effect'
import { createServer } from 'node:http'
import { TxAgentApi } from './api.js'
import { getApiEnv, getSubscriptionGuardEnabled, isAutoFixTriggerStubMode } from './config/env.js'
import { authPrincipalStampMiddleware } from './middleware/auth-principal-stamp.js'
import { authRateLimitMiddleware } from './middleware/auth-rate-limit.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { getCorsConfig } from './middleware/cors.js'
import { effectCauseLoggingMiddleware } from './middleware/effect-cause-logging.js'
import { requestContextMiddleware } from './middleware/request-context.js'
import { securityHeadersMiddleware } from './middleware/security-headers.js'
import { serverTimingMiddleware } from './middleware/server-timing.js'
import { traceContextMiddleware } from './middleware/trace-context.js'
import { InvitationEmailPortLive } from './adapters/invitation-email.js'
import { PasswordResetEmailPortLive } from './adapters/password-reset-email.js'
import { GoogleOidcPortLive } from './adapters/google-oidc.js'
import { StripePortLive } from './adapters/stripe.js'
import { AuthLive } from './routes/auth.js'
import { BillingLive } from './routes/billing.js'
import { HealthLive } from './routes/health.js'
import { OrganizationsLive } from './routes/organizations.js'
import { PermissionsLive } from './routes/permissions.js'
import { RolesLive } from './routes/roles.js'
import { TeamsLive } from './routes/teams.js'
import { StorageLive as StorageRouteLive } from './routes/storage.js'
import { EmailCampaignsLive } from './routes/email-campaigns.js'
import { EmailWebhooksLive } from './routes/email-webhooks.js'
import { EmailUnsubscribeLive } from './routes/email-unsubscribe.js'
import { SentryWebhooksLive } from './routes/sentry-webhooks.js'
import { AutoFixTriggerLive } from './adapters/temporal-control.js'
import { AutoFixTriggerStubLive } from './adapters/auto-fix-trigger-stub.js'
import { StorageLive as StorageServiceLive } from '@tx-agent-kit/storage'
import { AssetsLive } from './routes/assets.js'
import { StorageMeteringLive } from './routes/storage-metering.js'

const logger = createLogger('tx-agent-kit-api').child('server')

const ApiLive = HttpApiBuilder.api(TxAgentApi).pipe(
  Layer.provide(HealthLive),
  Layer.provide(AuthLive),
  Layer.provide(OrganizationsLive),
  Layer.provide(TeamsLive),
  Layer.provide(BillingLive),
  Layer.provide(PermissionsLive),
  Layer.provide(StorageRouteLive),
  Layer.provide(RolesLive),
  Layer.provide(AssetsLive),
  Layer.provide(StorageMeteringLive),
  Layer.provide(EmailCampaignsLive),
  Layer.provide(EmailWebhooksLive),
  Layer.provide(SentryWebhooksLive),
  Layer.provide(EmailUnsubscribeLive)
)

const MiddlewareLive = Layer.mergeAll(
  // Establishes per-request AsyncLocalStorage context (method/path + the
  // errorReported dedup cell). Must precede effectCauseLoggingMiddleware.
  HttpApiBuilder.middleware(requestContextMiddleware),
  // Last-resort boundary: logs+captures causes that bypass mapCoreError, and
  // skips any request mapCoreError already reported (log-once dedup).
  HttpApiBuilder.middleware(effectCauseLoggingMiddleware),
  // Resolve + stamp the caller's principal BEFORE route handlers decode params,
  // so the boundary can attribute a request-validation rejection to a real client.
  HttpApiBuilder.middleware(authPrincipalStampMiddleware),
  HttpApiBuilder.middleware(traceContextMiddleware),
  HttpApiBuilder.middleware(authRateLimitMiddleware),
  HttpApiBuilder.middleware(bodyLimitMiddleware),
  HttpApiBuilder.middlewareCors(getCorsConfig()),
  HttpApiBuilder.middlewareOpenApi({ path: '/openapi.json' }),
  HttpApiSwagger.layer({ path: '/docs' }),
  HttpApiBuilder.middleware(serverTimingMiddleware),
  // Security headers must be outermost (added last) so appendPreResponseHandler
  // runs before rate-limiter or body-limit short-circuit the pipeline.
  HttpApiBuilder.middleware(securityHeadersMiddleware)
)

const BillingGuardPortLive = Layer.succeed(BillingGuardPort, {
  isEnabled: () => Effect.succeed(getSubscriptionGuardEnabled())
})

const PortDependenciesLive = Layer.mergeAll(
  AuthUsersPortLive,
  AuthLoginSessionPortLive,
  AuthLoginRefreshTokenPortLive,
  AuthLoginIdentityPortLive,
  AuthLoginAuditPortLive,
  AuthOrganizationMembershipPortLive,
  AuthOrganizationOwnershipPortLive,
  PasswordResetTokenPortLive,
  InvitationEmailPortLive,
  PasswordResetEmailPortLive,
  GoogleOidcPortLive,
  PasswordHasherPortLive,
  SessionTokenPortLive,
  OrganizationStorePortLive,
  OrganizationInvitationStorePortLive,
  OrganizationUsersPortLive,
  BillingStorePortLive,
  BillingUiPreferenceStorePortLive,
  UsageStorePortLive,
  SubscriptionEventStorePortLive,
  StripePortLive,
  BillingGuardPortLive,
  ClockPortLive,
  RoleStorePortLive,
  TeamStorePortLive,
  TeamOrganizationMembershipPortLive,
  ContentReviewTokenStorePortLive,
  OrganizationMemberStorePortLive,
  StorageServiceLive,
  MediaAssetStorePortLive,
  PendingUploadStorePortLive,
  StorageMeteringPortLive,
  CollectionStorePortLive,
  StorageAdapterPortLive.pipe(Layer.provide(StorageServiceLive)),
  TeamLookupPortLive,
  SubscriptionLookupPortLive,
  CreditLedgerStorePortLive,
  ProcessedStripeEventStorePortLive,
  StorageUsageReaderPortLive,
  UsageCapStorePortLive,
  AutoRechargeAttemptStorePortLive,
  CampaignStorePortLive,
  CampaignStepStorePortLive,
  EnrollmentStorePortLive,
  EmailSendStorePortLive,
  UnsubscribeStorePortLive,
  SuppressionStorePortLive
)

const CreditServicePortLive = Layer.effect(CreditServicePort, makeCreditService)
const StorageBillingServicePortLive = Layer.effect(
  StorageBillingServicePort,
  makeStorageBillingService
)
const UsageCapServicePortLive = Layer.effect(UsageCapServicePort, makeUsageCapService)

// Note: ContentReviewTokenService is not wired here — the token lifecycle
// (create, validate, revoke) is managed through TeamService, which owns
// the content review token store internally.
const ServiceDependenciesLive = Layer.mergeAll(
  AuthServiceLive,
  BillingServiceLive,
  OrganizationMemberServiceLive,
  OrganizationServiceLive,
  RoleServiceLive,
  TeamAuthMiddlewareLive,
  OrgAuthMiddlewareLive,
  TeamServiceLive,
  UploadServiceLive,
  MediaAssetServiceLive,
  CollectionServiceLive,
  StorageMeteringServiceLive,
  CreditServicePortLive,
  StorageBillingServicePortLive,
  UsageCapServicePortLive,
  EmailCampaignServiceLive
)

// Auto-fix trigger seam: the live Temporal-backed adapter, OR (test-only, when
// AUTO_FIX_TRIGGER_MODE=stub) an in-process recording stub that needs the
// AutoFixRunStoreTestPort audit hook, so it is provided that layer here.
const autoFixTriggerLayer = isAutoFixTriggerStubMode()
  ? AutoFixTriggerStubLive.pipe(Layer.provide(AutoFixRunStoreTestLive))
  : AutoFixTriggerLive

const AutoFixDependenciesLive = Layer.mergeAll(
  AutoFixRunStoreLive,
  autoFixTriggerLayer
)

const ApiWithDependenciesLive = ApiLive.pipe(
  Layer.provide(ServiceDependenciesLive),
  Layer.provide(PortDependenciesLive),
  Layer.provide(AutoFixDependenciesLive)
)

export const makeServerLive = (options?: { port?: number; host?: string }) => {
  const env = getApiEnv()
  const port = options?.port ?? Number.parseInt(env.API_PORT, 10)
  const host = options?.host ?? env.API_HOST

  return HttpApiBuilder.serve().pipe(
    Layer.provide(MiddlewareLive),
    Layer.provide(ApiWithDependenciesLive),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port, host }))
  )
}

export const main = (): void => {
  const env = getApiEnv()
  const port = Number.parseInt(env.API_PORT, 10)
  const host = env.API_HOST
  const layer = makeServerLive({ port, host })
  logger.info('Starting API server.', { host, port })

  try {
    startTelemetry('tx-agent-kit-api')
  } catch (error) {
    logger.error(
      'Failed to initialize OpenTelemetry.',
      { host, port },
      error instanceof Error ? error : new Error(String(error))
    )
  }

  void (async () => {
    try {
      await initializeApiSentry(env)
    } catch (sentryError: unknown) {
      logger.error(
        'Failed to initialize Sentry.',
        { host, port },
        sentryError instanceof Error ? sentryError : new Error(String(sentryError))
      )
    }
  })()

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    logger.info('Stopping API server.', { signal })

    const forceExitTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit.')
      process.exit(1)
    }, 15_000)
    forceExitTimeout.unref()

    void (async () => {
      try {
        await Promise.all([stopTelemetry(), flushApiSentry(), closeRedisClients()])
      } catch (telemetryError) {
        logger.error(
          'Telemetry shutdown error.',
          {},
          telemetryError instanceof Error ? telemetryError : new Error(String(telemetryError))
        )
      } finally {
        logger.info('API server stopped.')
        process.exit(0)
      }
    })()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  NodeRuntime.runMain(Layer.launch(layer))
}
