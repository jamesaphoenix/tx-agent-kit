import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, WorkspaceService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { parseListQuery } from './list-query.js'

export const WorkspacesRouteKind = 'crud' as const

const toApiWorkspace = (workspace: {
  id: string
  name: string
  ownerUserId: string
  createdAt: Date
}) => ({
  id: workspace.id,
  name: workspace.name,
  ownerUserId: workspace.ownerUserId,
  createdAt: workspace.createdAt.toISOString()
})

const toApiInvitation = (invitation: {
  id: string
  workspaceId: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}) => ({
  id: invitation.id,
  workspaceId: invitation.workspaceId,
  email: invitation.email,
  role: invitation.role === 'owner' ? 'admin' as const : invitation.role,
  status: invitation.status,
  invitedByUserId: invitation.invitedByUserId,
  token: invitation.token,
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString()
})

export const WorkspacesLive = HttpApiBuilder.group(TxAgentApi, 'workspaces', (handlers) =>
  handlers
    .handle('listWorkspaces', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'name'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listForUser(principal.userId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiWorkspace),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getWorkspace', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const workspace = yield* service.getById(principal, path.workspaceId).pipe(Effect.mapError(mapCoreError))
        return toApiWorkspace(workspace)
      })
    )
    .handle('getManyWorkspaces', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const workspaces = yield* service.getManyByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))

        return {
          data: workspaces.map(toApiWorkspace)
        }
      })
    )
    .handle('createWorkspace', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const workspace = yield* service.createForUser(principal.userId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiWorkspace(workspace)
      })
    )
    .handle('updateWorkspace', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const workspace = yield* service.updateById(principal, path.workspaceId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiWorkspace(workspace)
      })
    )
    .handle('removeWorkspace', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.removeById(principal, path.workspaceId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('listInvitations', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'expiresAt'],
          allowedFilterKeys: ['status', 'role']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listInvitationsForUser(principal.userId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiInvitation),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getInvitation', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const invitation = yield* service.getInvitationById(principal, path.invitationId).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('getManyInvitations', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const invitations = yield* service.getManyInvitationsByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))

        return {
          data: invitations.map(toApiInvitation)
        }
      })
    )
    .handle('createInvitation', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const invitation = yield* service.createInvitation(principal, payload).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('updateInvitation', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        const invitation = yield* service.updateInvitationById(principal, path.invitationId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('removeInvitation', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.removeInvitationById(principal, path.invitationId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('acceptInvitation', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.acceptInvitation(principal, path.token).pipe(Effect.mapError(mapCoreError))
      })
    )
)
