import { HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { mapCoreError } from './api.js'

export const requireAuth = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  return yield* principalFromAuthorization(request.headers.authorization).pipe(
    Effect.mapError(mapCoreError)
  )
})
