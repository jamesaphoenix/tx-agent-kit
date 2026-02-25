import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, TeamService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { parseListQuery } from './list-query.js'

export const TeamsRouteKind = 'crud' as const

const toApiTeam = (team: {
  id: string
  organizationId: string
  name: string
  website: string | null
  createdAt: Date
  updatedAt: Date
}) => ({
  id: team.id,
  organizationId: team.organizationId,
  name: team.name,
  website: team.website,
  createdAt: team.createdAt.toISOString(),
  updatedAt: team.updatedAt.toISOString()
})

export const TeamsLive = HttpApiBuilder.group(TxAgentApi, 'teams', (handlers) =>
  handlers
    .handle('listTeams', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TeamService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'name'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service
          .listForOrganization(principal, urlParams.organizationId, parsed.value)
          .pipe(Effect.mapError(mapCoreError))

        return {
          data: page.data.map(toApiTeam),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getTeam', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TeamService
        const team = yield* service.getById(principal, path.teamId).pipe(Effect.mapError(mapCoreError))
        return toApiTeam(team)
      })
    )
    .handle('createTeam', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TeamService
        const team = yield* service.create(principal, payload).pipe(Effect.mapError(mapCoreError))
        return toApiTeam(team)
      })
    )
    .handle('updateTeam', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TeamService
        const team = yield* service.update(principal, path.teamId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiTeam(team)
      })
    )
    .handle('removeTeam', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TeamService
        return yield* service.remove(principal, path.teamId).pipe(Effect.mapError(mapCoreError))
      })
    )
)
