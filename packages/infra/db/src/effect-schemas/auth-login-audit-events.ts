import * as Schema from 'effect/Schema'
import { authLoginAuditEventTypes, authLoginAuditStatuses } from '@tx-agent-kit/contracts'

const authLoginAuditMetadataValueSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null
)

export const authLoginAuditStatusSchema = Schema.Literal(...authLoginAuditStatuses)

export const authLoginAuditEventTypeSchema = Schema.Literal(...authLoginAuditEventTypes)

export const authLoginAuditEventRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.NullOr(Schema.UUID),
  eventType: authLoginAuditEventTypeSchema,
  status: authLoginAuditStatusSchema,
  identifier: Schema.NullOr(Schema.String),
  ipAddress: Schema.NullOr(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: authLoginAuditMetadataValueSchema }),
  createdAt: Schema.DateFromSelf
})

export type AuthLoginAuditEventRowShape = Schema.Schema.Type<typeof authLoginAuditEventRowSchema>
