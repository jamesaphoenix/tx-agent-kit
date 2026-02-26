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
  BillingGuardPort,
  BillingServiceLive,
  BillingStorePortLive,
  ClockPortLive,
  PasswordResetTokenPortLive,
  PasswordHasherPortLive,
  SessionTokenPortLive,
  OrganizationInvitationStorePortLive,
  OrganizationServiceLive,
  OrganizationStorePortLive,
  OrganizationUsersPortLive,
  SubscriptionEventStorePortLive,
  TeamServiceLive,
  TeamStorePortLive,
  TeamOrganizationMembershipPortLive,
  UsageStorePortLive
} from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { Effect, Layer } from 'effect'
import { createServer } from 'node:http'
import { TxAgentApi } from './api.js'
import { getApiEnv, getSubscriptionGuardEnabled } from './config/env.js'
import { authRateLimitMiddleware } from './middleware/auth-rate-limit.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { getCorsConfig } from './middleware/cors.js'
import { InvitationEmailPortLive } from './adapters/invitation-email.js'
import { PasswordResetEmailPortLive } from './adapters/password-reset-email.js'
import { GoogleOidcPortLive } from './adapters/google-oidc.js'
import { StripePortLive } from './adapters/stripe.js'
import { AuthLive } from './routes/auth.js'
import { BillingLive } from './routes/billing.js'
import { HealthLive } from './routes/health.js'
import { OrganizationsLive } from './routes/organizations.js'
import { PermissionsLive } from './routes/permissions.js'
import { TeamsLive } from './routes/teams.js'

const logger = createLogger('tx-agent-kit-api').child('server')

const ApiLive = HttpApiBuilder.api(TxAgentApi).pipe(
  Layer.provide(HealthLive),
  Layer.provide(AuthLive),
  Layer.provide(OrganizationsLive),
  Layer.provide(TeamsLive),
  Layer.provide(BillingLive),
  Layer.provide(PermissionsLive)
)

const MiddlewareLive = Layer.mergeAll(
  HttpApiBuilder.middleware(authRateLimitMiddleware),
  HttpApiBuilder.middleware(bodyLimitMiddleware),
  HttpApiBuilder.middlewareCors(getCorsConfig()),
  HttpApiBuilder.middlewareOpenApi({ path: '/openapi.json' }),
  HttpApiSwagger.layer({ path: '/docs' })
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
  UsageStorePortLive,
  SubscriptionEventStorePortLive,
  StripePortLive,
  BillingGuardPortLive,
  ClockPortLive,
  TeamStorePortLive,
  TeamOrganizationMembershipPortLive
)

const ServiceDependenciesLive = Layer.mergeAll(
  AuthServiceLive,
  BillingServiceLive,
  OrganizationServiceLive,
  TeamServiceLive
)

const ApiWithDependenciesLive = ApiLive.pipe(
  Layer.provide(ServiceDependenciesLive),
  Layer.provide(PortDependenciesLive)
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

  void (async () => {
    try {
      await startTelemetry('tx-agent-kit-api')
    } catch (error) {
      logger.error(
        'Failed to initialize OpenTelemetry.',
        { host, port },
        error instanceof Error ? error : new Error(String(error))
      )
    }
  })()

  NodeRuntime.runMain(Layer.launch(layer))

  const shutdown = () => {
    logger.info('Stopping API server.')
    void (async () => {
      try {
        await stopTelemetry()
      } finally {
        process.exit(0)
      }
    })()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
