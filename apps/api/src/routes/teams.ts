import { HttpApiBuilder } from '@effect/platform'
import { TeamService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { requireTeamPermission } from '../auth-helpers.js'
import { toApiTeam, toApiTeamMember, toApiReviewToken } from '../mappers/team-mapper.js'
import { requireAuth } from '../utils.js'
import { parseListQuery } from './list-query.js'

export const TeamsRouteKind = 'crud' as const

export const TeamsLive = HttpApiBuilder.group(TxAgentApi, 'teams', (handlers) =>
  handlers
    .handle('listTeams', ({ urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
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
        const { principal } = yield* requireTeamPermission(path.teamId, 'view_organization')
        const service = yield* TeamService
        const team = yield* service.getById(principal, path.teamId).pipe(Effect.mapError(mapCoreError))
        return toApiTeam(team)
      })
    )
    .handle('createTeam', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService
        const team = yield* service.create(principal, payload).pipe(Effect.mapError(mapCoreError))
        return toApiTeam(team)
      })
    )
    .handle('updateTeam', ({ path, payload }) =>
      Effect.gen(function* () {
        const { principal } = yield* requireTeamPermission(path.teamId, 'manage_organization')
        const service = yield* TeamService
        const team = yield* service.update(principal, path.teamId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiTeam(team)
      })
    )
    .handle('removeTeam', ({ path }) =>
      Effect.gen(function* () {
        const { principal } = yield* requireTeamPermission(path.teamId, 'delete_teams')
        const service = yield* TeamService
        return yield* service.remove(principal, path.teamId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('createReviewToken', ({ path, payload }) =>
      Effect.gen(function* () {
        const { principal } = yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* TeamService
        const token = yield* service.createReviewToken(principal, path.teamId, {
          permissions: [...payload.permissions],
          reviewerName: payload.reviewerName,
          reviewerEmail: payload.reviewerEmail,
          expiresInDays: payload.expiresInDays
        }).pipe(Effect.mapError(mapCoreError))
        return toApiReviewToken(token)
      })
    )
    .handle('listReviewTokens', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const { principal } = yield* requireTeamPermission(path.teamId, 'view_assets')
        const service = yield* TeamService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'expiresAt'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listReviewTokens(principal, path.teamId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiReviewToken),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('revokeReviewToken', ({ path }) =>
      Effect.gen(function* () {
        const { principal } = yield* requireTeamPermission(path.teamId, 'manage_assets')
        const service = yield* TeamService
        return yield* service.revokeReviewToken(principal, path.teamId, path.tokenId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('validateReviewToken', ({ path }) =>
      Effect.gen(function* () {
        const service = yield* TeamService
        const result = yield* service.validateReviewToken(path.token).pipe(Effect.mapError(mapCoreError))

        if (!result.valid || !result.token) {
          return { valid: false }
        }

        return {
          valid: true,
          token: toApiReviewToken(result.token),
          teamId: result.teamId,
          permissions: result.permissions
        }
      })
    )
    .handle('listTeamMembers', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listMembers(principal, path.teamId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiTeamMember),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('addTeamMember', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService
        const member = yield* service.addMemberById(principal, path.teamId, payload.userId).pipe(Effect.mapError(mapCoreError))
        return toApiTeamMember(member)
      })
    )
    .handle('updateTeamMemberRole', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService
        const member = yield* service.updateMemberRole(principal, path.teamId, path.memberId, payload.roleId).pipe(Effect.mapError(mapCoreError))
        return toApiTeamMember(member)
      })
    )
    .handle('removeTeamMember', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService
        return yield* service.removeTeamMember(principal, path.teamId, path.memberId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('disableTeamMember', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService
        const member = yield* service.disableTeamMember(principal, path.teamId, path.memberId).pipe(Effect.mapError(mapCoreError))
        return toApiTeamMember(member)
      })
    )
    .handle('enableTeamMember', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* TeamService
        const member = yield* service.enableTeamMember(principal, path.teamId, path.memberId).pipe(Effect.mapError(mapCoreError))
        return toApiTeamMember(member)
      })
    )
)
