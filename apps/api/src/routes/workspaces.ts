import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, WorkspaceService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'

export const WorkspacesLive = HttpApiBuilder.group(TxAgentApi, 'workspaces', (handlers) =>
  handlers
    .handle('listWorkspaces', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.listForUser(principal.userId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('createWorkspace', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.createForUser(principal.userId, payload).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('listInvitations', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.listInvitationsForUser(principal.userId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('createInvitation', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* WorkspaceService
        return yield* service.createInvitation(principal, payload).pipe(Effect.mapError(mapCoreError))
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
