import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'
import { TxAgentApi } from '../api.js'

export const HealthLive = HttpApiBuilder.group(TxAgentApi, 'health', (handlers) =>
  handlers.handle('health', () =>
    Effect.succeed({
      status: 'healthy' as const,
      timestamp: new Date().toISOString(),
      service: 'tx-agent-kit-api'
    })
  )
)
