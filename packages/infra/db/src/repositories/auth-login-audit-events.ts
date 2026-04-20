import type { AuthLoginAuditEventType, AuthLoginAuditStatus } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { authLoginAuditEventRowSchema } from '../effect-schemas/auth-login-audit-events.js'
import { authLoginAuditEvents, type JsonObject } from '../schema.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(authLoginAuditEventRowSchema, 'auth login audit event row')

export const authLoginAuditEventsRepository = {
  create: (input: {
    userId: string | null
    eventType: AuthLoginAuditEventType
    status: AuthLoginAuditStatus
    identifier: string | null
    ipAddress: string | null
    metadata: JsonObject
  }) =>
    withDb('Failed to create auth login audit event', (db) =>
      Effect.gen(function* () {
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

        return yield* decodeFirst(rows, decode)
      })
    )
}
