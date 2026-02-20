import * as Schema from 'effect/Schema'
import { emailSchema } from './common.js'

export const userSchema = Schema.Struct({
  id: Schema.UUID,
  email: emailSchema,
  name: Schema.String.pipe(Schema.minLength(1)),
  createdAt: Schema.String
})

export const authPrincipalSchema = Schema.Struct({
  userId: Schema.UUID,
  email: emailSchema,
  workspaceId: Schema.optional(Schema.UUID),
  roles: Schema.Array(Schema.String)
})

export const signUpRequestSchema = Schema.Struct({
  email: emailSchema,
  password: Schema.String.pipe(Schema.minLength(8)),
  name: Schema.String.pipe(Schema.minLength(1))
})

export const signInRequestSchema = Schema.Struct({
  email: emailSchema,
  password: Schema.String.pipe(Schema.minLength(8))
})

export const authResponseSchema = Schema.Struct({
  token: Schema.String,
  user: userSchema
})

export type User = Schema.Schema.Type<typeof userSchema>
export type AuthPrincipal = Schema.Schema.Type<typeof authPrincipalSchema>
export type SignUpRequest = Schema.Schema.Type<typeof signUpRequestSchema>
export type SignInRequest = Schema.Schema.Type<typeof signInRequestSchema>
export type AuthResponse = Schema.Schema.Type<typeof authResponseSchema>
