import * as Schema from 'effect/Schema'
import { authLoginProviderSchema } from './auth-login-sessions.js'

export const authLoginOidcStateRowSchema = Schema.Struct({
  id: Schema.UUID,
  provider: authLoginProviderSchema,
  state: Schema.String,
  nonce: Schema.String,
  codeVerifier: Schema.String,
  redirectUri: Schema.String,
  requesterIp: Schema.NullOr(Schema.String),
  expiresAt: Schema.DateFromSelf,
  consumedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type AuthLoginOidcStateRowShape = Schema.Schema.Type<typeof authLoginOidcStateRowSchema>
