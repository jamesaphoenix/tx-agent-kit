import { pendingUploadStatuses } from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'

export const pendingUploadRowSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  userId: Schema.UUID,
  declaredFileSize: Schema.Number,
  contentHash: Schema.NullOr(Schema.String),
  mimeType: Schema.String,
  storagePath: Schema.String,
  presignedUrl: Schema.String,
  status: Schema.Literal(...pendingUploadStatuses),
  expiresAt: Schema.DateFromSelf,
  createdAt: Schema.DateFromSelf
})

export type PendingUploadRowShape = Schema.Schema.Type<typeof pendingUploadRowSchema>
