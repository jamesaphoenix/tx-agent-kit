import * as Schema from 'effect/Schema'
import { authLoginProviders } from '@tx-agent-kit/contracts'

export const authLoginProviderSchema = Schema.Literal(...authLoginProviders)

export const authLoginSessionRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.UUID,
  provider: authLoginProviderSchema,
  createdIp: Schema.NullOr(Schema.String),
  createdUserAgent: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.DateFromSelf,
  expiresAt: Schema.DateFromSelf,
  revokedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type AuthLoginSessionRowShape = Schema.Schema.Type<typeof authLoginSessionRowSchema>
