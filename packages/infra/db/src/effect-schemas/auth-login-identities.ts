import * as Schema from 'effect/Schema'
import { authLoginProviderSchema } from './auth-login-sessions.js'

export const authLoginIdentityRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.UUID,
  provider: authLoginProviderSchema,
  providerSubject: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  createdAt: Schema.DateFromSelf
})

export type AuthLoginIdentityRowShape = Schema.Schema.Type<typeof authLoginIdentityRowSchema>
