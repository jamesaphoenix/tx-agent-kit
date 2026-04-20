import { HttpApiBuilder } from '@effect/platform'
import { RoleService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { toApiRole } from '../mappers/role-mapper.js'
import { requireAuth } from '../utils.js'
import { parseListQuery } from './list-query.js'

export const RolesRouteKind = 'custom' as const

export const RolesLive = HttpApiBuilder.group(TxAgentApi, 'roles', (handlers) =>
  handlers
    .handle('listRoles', ({ urlParams }) =>
      Effect.gen(function* () {
        const _principal = yield* requireAuth
        const service = yield* RoleService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'name'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.list(parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiRole),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('createRole', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* RoleService
        const role = yield* service.create({
          name: payload.name,
          permissions: [...payload.permissions],
          principal
        }).pipe(Effect.mapError(mapCoreError))
        return toApiRole(role)
      })
    )
    .handle('updateRole', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* RoleService
        const role = yield* service.update(path.roleId, {
          name: payload.name,
          permissions: payload.permissions ? [...payload.permissions] : undefined,
          principal
        }).pipe(Effect.mapError(mapCoreError))
        return toApiRole(role)
      })
    )
    .handle('removeRole', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* RoleService
        return yield* service.remove(path.roleId, { principal }).pipe(Effect.mapError(mapCoreError))
      })
    )
)
