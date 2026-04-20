import { HttpApiBuilder } from '@effect/platform'
import { OrganizationService } from '@tx-agent-kit/core'
import { getPermissionsForRole, rolePermissionMap } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'
import { requireAuth } from '../utils.js'

export const PermissionsRouteKind = 'custom' as const

export const PermissionsLive = HttpApiBuilder.group(TxAgentApi, 'permissions', (handlers) =>
  handlers
    .handle('getPermissionMap', () =>
      Effect.succeed(rolePermissionMap)
    )
    .handle('getMyPermissions', () =>
      Effect.gen(function* () {
        const principal = yield* requireAuth

        const organizationId = principal.organizationId
        if (!organizationId) {
          return {
            isOwner: false,
            permissions: [] as const
          }
        }

        const organizationService = yield* OrganizationService
        const role = yield* organizationService.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError(mapCoreError)
        )

        if (!role) {
          return {
            organizationId,
            isOwner: false,
            permissions: [] as const
          }
        }

        const org = yield* organizationService.getById({ userId: principal.userId }, organizationId).pipe(
          Effect.mapError(mapCoreError)
        )

        return {
          organizationId,
          role,
          isOwner: org.ownerUserId === principal.userId,
          permissions: [...getPermissionsForRole(role)]
        }
      })
    )
)
