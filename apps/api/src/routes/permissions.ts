import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, OrganizationStorePort } from '@tx-agent-kit/core'
import { getPermissionsForRole, rolePermissionMap } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'

export const PermissionsRouteKind = 'custom' as const

export const PermissionsLive = HttpApiBuilder.group(TxAgentApi, 'permissions', (handlers) =>
  handlers
    .handle('getPermissionMap', () =>
      Effect.succeed(rolePermissionMap)
    )
    .handle('getMyPermissions', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(
          Effect.mapError(mapCoreError)
        )

        const organizationId = principal.organizationId
        if (!organizationId) {
          return {
            permissions: [] as const
          }
        }

        const organizationStore = yield* OrganizationStorePort
        const role = yield* organizationStore.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError(mapCoreError)
        )

        if (!role) {
          return {
            organizationId,
            permissions: [] as const
          }
        }

        return {
          organizationId,
          role,
          permissions: [...getPermissionsForRole(role)]
        }
      })
    )
)
