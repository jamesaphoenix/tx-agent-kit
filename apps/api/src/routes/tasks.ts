import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, TaskService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'

export const TasksLive = HttpApiBuilder.group(TxAgentApi, 'tasks', (handlers) =>
  handlers
    .handle('listTasks', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        return yield* service.listByWorkspace(principal, urlParams.workspaceId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('createTask', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* TaskService
        return yield* service.create(principal, payload).pipe(Effect.mapError(mapCoreError))
      })
    )
)
