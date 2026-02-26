import type { AuthLoginAuditEventType, AuthLoginAuditStatus } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  authLoginAuditEventRowSchema,
  type AuthLoginAuditEventRowShape
} from '../effect-schemas/auth-login-audit-events.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { authLoginAuditEvents, type JsonObject } from '../schema.js'

const decodeAuthLoginAuditEventRow = Schema.decodeUnknown(authLoginAuditEventRowSchema)

const decodeNullableAuthLoginAuditEvent = (
  value: unknown
): Effect.Effect<AuthLoginAuditEventRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeAuthLoginAuditEventRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('auth login audit event row decode failed', error))
  )
}

export const authLoginAuditEventsRepository = {
  create: (input: {
    userId: string | null
    eventType: AuthLoginAuditEventType
    status: AuthLoginAuditStatus
    identifier: string | null
    ipAddress: string | null
    metadata: JsonObject
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(authLoginAuditEvents)
          .values({
            userId: input.userId,
            eventType: input.eventType,
            status: input.status,
            identifier: input.identifier,
            ipAddress: input.ipAddress,
            metadata: input.metadata
          })
          .returning()
          .execute()

        return yield* decodeNullableAuthLoginAuditEvent(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create auth login audit event', error)))
}
