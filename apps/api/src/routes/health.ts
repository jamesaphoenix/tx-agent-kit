import { HttpApiBuilder } from '@effect/platform'
import { DateTime, Effect } from 'effect'
import { TxAgentApi } from '../api.js'

export const HealthRouteKind = 'custom' as const

export const HealthLive = HttpApiBuilder.group(TxAgentApi, 'health', (handlers) =>
  handlers.handle('health', () =>
    Effect.map(DateTime.now, (now) => ({
      status: 'healthy' as const,
      timestamp: DateTime.formatIso(now),
      service: 'tx-agent-kit-api'
    }))
  )
)
