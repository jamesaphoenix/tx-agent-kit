import { HttpApiBuilder } from '@effect/platform'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import {
  AuthServiceLive,
  AuthUsersPortLive,
  AuthOrganizationOwnershipPortLive,
  PasswordResetTokenPortLive,
  PasswordHasherPortLive,
  SessionTokenPortLive,
  OrganizationInvitationStorePortLive,
  OrganizationServiceLive,
  OrganizationStorePortLive,
  OrganizationUsersPortLive,
  TeamServiceLive,
  TeamStorePortLive,
  TeamOrganizationMembershipPortLive
} from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { Layer } from 'effect'
import { createServer } from 'node:http'
import { TxAgentApi } from './api.js'
import { getApiEnv } from './config/env.js'
import { authRateLimitMiddleware } from './middleware/auth-rate-limit.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { getCorsConfig } from './middleware/cors.js'
import { InvitationEmailPortLive } from './adapters/invitation-email.js'
import { PasswordResetEmailPortLive } from './adapters/password-reset-email.js'
import { AuthLive } from './routes/auth.js'
import { HealthLive } from './routes/health.js'
import { OrganizationsLive } from './routes/organizations.js'
import { TeamsLive } from './routes/teams.js'

const logger = createLogger('tx-agent-kit-api').child('server')

const ApiLive = HttpApiBuilder.api(TxAgentApi).pipe(
  Layer.provide(HealthLive),
  Layer.provide(AuthLive),
  Layer.provide(OrganizationsLive),
  Layer.provide(TeamsLive)
)

export const makeServerLive = (options?: { port?: number; host?: string }) => {
  const env = getApiEnv()
  const port = options?.port ?? Number.parseInt(env.API_PORT, 10)
  const host = options?.host ?? env.API_HOST

  return HttpApiBuilder.serve().pipe(
    Layer.provide(HttpApiBuilder.middleware(authRateLimitMiddleware)),
    Layer.provide(HttpApiBuilder.middleware(bodyLimitMiddleware)),
    Layer.provide(HttpApiBuilder.middlewareCors(getCorsConfig())),
    Layer.provide(ApiLive),
    Layer.provide(AuthUsersPortLive),
    Layer.provide(AuthOrganizationOwnershipPortLive),
    Layer.provide(PasswordResetTokenPortLive),
    Layer.provide(InvitationEmailPortLive),
    Layer.provide(PasswordResetEmailPortLive),
    Layer.provide(PasswordHasherPortLive),
    Layer.provide(SessionTokenPortLive),
    Layer.provide(OrganizationStorePortLive),
    Layer.provide(OrganizationInvitationStorePortLive),
    Layer.provide(OrganizationUsersPortLive),
    Layer.provide(TeamStorePortLive),
    Layer.provide(TeamOrganizationMembershipPortLive),
    Layer.provide(AuthServiceLive),
    Layer.provide(OrganizationServiceLive),
    Layer.provide(TeamServiceLive),
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
