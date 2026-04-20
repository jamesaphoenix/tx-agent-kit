import * as Schema from 'effect/Schema'

/**
 * Permitted value types inside the `notifications.metadata` JSONB column.
 *
 * Notifications span many upstream event payloads (welcome credits,
 * low-balance, 3DS challenges, dispute resolutions) so this schema is a
 * union of the primitive types the worker handler actually passes plus a
 * nested record for compound payloads (e.g. a charge summary object).
 *
 * Never accept `Schema.Unknown` here — the row-schema lint invariant
 * requires explicit structural shapes for every JSONB column.
 */
const notificationMetadataPrimitiveSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null
)

const notificationMetadataValueSchema: Schema.Schema<NotificationMetadataValue> = Schema.Union(
  notificationMetadataPrimitiveSchema,
  Schema.Array(Schema.suspend(() => notificationMetadataValueSchema)),
  Schema.Record({
    key: Schema.String,
    value: Schema.suspend(() => notificationMetadataValueSchema)
  })
)

export type NotificationMetadataValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<NotificationMetadataValue>
  | { readonly [key: string]: NotificationMetadataValue }

/**
 * Effect schema for the `notifications` table row. Mirrors the Drizzle
 * schema in `../schema.ts` — keep the two in sync.
 *
 * @spec notifications-design §"Data Model"
 */
export const notificationRowSchema = Schema.Struct({
  id: Schema.UUID,
  organizationId: Schema.NullOr(Schema.UUID),
  userId: Schema.NullOr(Schema.UUID),
  eventType: Schema.String,
  title: Schema.String,
  body: Schema.String,
  metadata: Schema.Record({ key: Schema.String, value: notificationMetadataValueSchema }),
  readAt: Schema.NullOr(Schema.DateFromSelf),
  digestBatchId: Schema.NullOr(Schema.UUID),
  emailedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type NotificationRowShape = Schema.Schema.Type<typeof notificationRowSchema>
