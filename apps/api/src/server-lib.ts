import { HttpApiBuilder } from '@effect/platform'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { AuthServiceLive, TaskServiceLive, WorkspaceServiceLive } from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { startTelemetry, stopTelemetry } from '@tx-agent-kit/observability'
import { Layer } from 'effect'
import { createServer } from 'node:http'
import { TxAgentApi } from './api.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { getCorsConfig } from './middleware/cors.js'
import { AuthLive } from './routes/auth.js'
import { HealthLive } from './routes/health.js'
import { TasksLive } from './routes/tasks.js'
import { WorkspacesLive } from './routes/workspaces.js'

const logger = createLogger('tx-agent-kit-api').child('server')

const ApiLive = HttpApiBuilder.api(TxAgentApi).pipe(
  Layer.provide(HealthLive),
  Layer.provide(AuthLive),
  Layer.provide(WorkspacesLive),
  Layer.provide(TasksLive)
)

export const makeServerLive = (options?: { port?: number; host?: string }) => {
  const port = options?.port ?? Number.parseInt(process.env.API_PORT ?? '4000', 10)
  const host = options?.host ?? process.env.API_HOST ?? '0.0.0.0'

  return HttpApiBuilder.serve().pipe(
    Layer.provide(HttpApiBuilder.middleware(bodyLimitMiddleware)),
    Layer.provide(HttpApiBuilder.middlewareCors(getCorsConfig())),
    Layer.provide(ApiLive),
    Layer.provide(AuthServiceLive),
    Layer.provide(WorkspaceServiceLive),
    Layer.provide(TaskServiceLive),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port, host }))
  )
}

export const main = (): void => {
  const port = Number.parseInt(process.env.API_PORT ?? '4000', 10)
  const host = process.env.API_HOST ?? '0.0.0.0'
  logger.info('Starting API server.', { host, port })

  void startTelemetry('tx-agent-kit-api')

  const layer = makeServerLive({ port, host })
  NodeRuntime.runMain(Layer.launch(layer))

  const shutdown = () => {
    logger.info('Stopping API server.')
    void stopTelemetry().finally(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
