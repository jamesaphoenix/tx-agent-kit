import { HttpApiBuilder } from '@effect/platform'
import { StorageMeteringService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'
import { requireOrgAuth } from '../auth-helpers.js'
import { toApiStorageMetering } from '../mappers/asset-mapper.js'

export const StorageMeteringRouteKind = 'custom' as const

export const StorageMeteringLive = HttpApiBuilder.group(TxAgentApi, 'storagemetering', (handlers) =>
  handlers
    .handle('getStorageUsage', ({ path }) =>
      Effect.gen(function* () {
        yield* requireOrgAuth(path.organizationId)
        const service = yield* StorageMeteringService
        const usage = yield* service.getUsage(path.organizationId).pipe(Effect.mapError(mapCoreError))
        return toApiStorageMetering(usage)
      })
    )
    .handle('getStorageQuota', ({ path }) =>
      Effect.gen(function* () {
        yield* requireOrgAuth(path.organizationId)
        const service = yield* StorageMeteringService
        const quota = yield* service.checkQuota(path.organizationId, 0).pipe(Effect.mapError(mapCoreError))
        return {
          allowed: quota.allowed,
          currentBytes: quota.currentBytes,
          limitBytes: quota.hardCapBytes
        }
      })
    )
)
