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
  organizationId: Schema.optional(Schema.UUID),
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

export const forgotPasswordRequestSchema = Schema.Struct({
  email: emailSchema
})

export const forgotPasswordResponseSchema = Schema.Struct({
  accepted: Schema.Boolean
})

export const resetPasswordRequestSchema = Schema.Struct({
  token: Schema.String.pipe(Schema.minLength(1)),
  password: Schema.String.pipe(Schema.minLength(8))
})

export const resetPasswordResponseSchema = Schema.Struct({
  reset: Schema.Boolean
})

export const authResponseSchema = Schema.Struct({
  token: Schema.String,
  user: userSchema
})

export type User = Schema.Schema.Type<typeof userSchema>
export type AuthPrincipal = Schema.Schema.Type<typeof authPrincipalSchema>
export type SignUpRequest = Schema.Schema.Type<typeof signUpRequestSchema>
export type SignInRequest = Schema.Schema.Type<typeof signInRequestSchema>
export type ForgotPasswordRequest = Schema.Schema.Type<typeof forgotPasswordRequestSchema>
export type ForgotPasswordResponse = Schema.Schema.Type<typeof forgotPasswordResponseSchema>
export type ResetPasswordRequest = Schema.Schema.Type<typeof resetPasswordRequestSchema>
export type ResetPasswordResponse = Schema.Schema.Type<typeof resetPasswordResponseSchema>
export type AuthResponse = Schema.Schema.Type<typeof authResponseSchema>
