import { Context, Effect, Layer } from 'effect'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  type ForgotPasswordCommand,
  isValidDisplayName,
  isValidEmail,
  normalizeEmail,
  type ResetPasswordCommand,
  toAuthPrincipal,
  toAuthUser,
  type AuthPrincipal,
  type AuthSession,
  type SignInCommand,
  type SignUpCommand
} from '../domain/auth-domain.js'
import {
  AuthUsersPort,
  AuthOrganizationOwnershipPort,
  PasswordResetEmailPort,
  PasswordResetTokenPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

const isEmailUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return code === 'DB_USER_EMAIL_UNIQUE_VIOLATION'
}

export class AuthService extends Context.Tag('AuthService')<
  AuthService,
  {
    signUp: (input: SignUpCommand) => Effect.Effect<AuthSession, CoreError, AuthUsersPort | PasswordHasherPort | SessionTokenPort>
    signIn: (input: SignInCommand) => Effect.Effect<AuthSession, CoreError, AuthUsersPort | PasswordHasherPort | SessionTokenPort>
    requestPasswordReset: (
      input: ForgotPasswordCommand
    ) => Effect.Effect<
      { accepted: true },
      CoreError,
      AuthUsersPort | PasswordResetTokenPort | PasswordResetEmailPort
    >
    resetPassword: (
      input: ResetPasswordCommand
    ) => Effect.Effect<
      { reset: true },
      CoreError,
      AuthUsersPort | PasswordHasherPort | PasswordResetTokenPort
    >
    getPrincipalFromToken: (token: string) => Effect.Effect<AuthPrincipal, CoreError, AuthUsersPort | SessionTokenPort>
    deleteUser: (
      principal: { userId: string }
    ) => Effect.Effect<{ deleted: true }, CoreError, AuthUsersPort | AuthOrganizationOwnershipPort>
  }
>() {}

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.succeed({
    signUp: (input) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort
        const sessionTokenPort = yield* SessionTokenPort

        if (!isValidEmail(input.email) || !isValidDisplayName(input.name) || input.password.length < 8) {
          return yield* Effect.fail(badRequest('Invalid sign-up payload'))
        }

        const email = normalizeEmail(input.email)
        const name = input.name.trim()

        const existing = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError(() => badRequest('Sign-up failed'))
        )

        if (existing) {
          return yield* Effect.fail(conflict('Email is already in use'))
        }

        const passwordHash = yield* passwordHasher.hash(input.password).pipe(
          Effect.mapError(() => badRequest('Could not hash password'))
        )

        const created = yield* usersPort.create({
          email,
          passwordHash,
          name
        }).pipe(
          Effect.catchAll((error) =>
            isEmailUniqueViolation(error)
              ? Effect.fail(conflict('Email is already in use'))
              : Effect.fail(badRequest('Sign-up failed'))
          )
        )

        if (!created) {
          return yield* Effect.fail(badRequest('User creation failed'))
        }

        const token = yield* sessionTokenPort.sign({
          sub: created.id,
          email: created.email,
          pwd: created.passwordChangedAt.getTime()
        }).pipe(Effect.mapError(() => unauthorized('Failed to create session token')))

        return {
          token,
          user: toAuthUser(created)
        }
      }),

    signIn: (input) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort
        const sessionTokenPort = yield* SessionTokenPort

        if (!isValidEmail(input.email) || input.password.length < 8) {
          return yield* Effect.fail(badRequest('Invalid sign-in payload'))
        }

        const email = normalizeEmail(input.email)

        const user = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError(() => unauthorized('Invalid credentials'))
        )

        if (!user) {
          return yield* Effect.fail(unauthorized('Invalid credentials'))
        }

        const ok = yield* passwordHasher.verify(input.password, user.passwordHash).pipe(
          Effect.mapError(() => unauthorized('Invalid credentials'))
        )

        if (!ok) {
          return yield* Effect.fail(unauthorized('Invalid credentials'))
        }

        const token = yield* sessionTokenPort.sign({
          sub: user.id,
          email: user.email,
          pwd: user.passwordChangedAt.getTime()
        }).pipe(Effect.mapError(() => unauthorized('Failed to create session token')))

        return {
          token,
          user: toAuthUser(user)
        }
      }),

    requestPasswordReset: (input) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordResetTokenPort = yield* PasswordResetTokenPort
        const passwordResetEmailPort = yield* PasswordResetEmailPort

        if (!isValidEmail(input.email)) {
          return yield* Effect.fail(badRequest('Invalid forgot-password payload'))
        }

        const email = normalizeEmail(input.email)
        const user = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError(() => badRequest('Failed to process forgot-password request'))
        )

        if (!user) {
          return { accepted: true as const }
        }

        yield* passwordResetTokenPort.revokeTokensForUser(user.id).pipe(
          Effect.mapError(() => badRequest('Failed to process forgot-password request'))
        )

        const token = yield* passwordResetTokenPort.createToken(user.id).pipe(
          Effect.mapError(() => badRequest('Failed to process forgot-password request'))
        )

        yield* passwordResetEmailPort.sendPasswordResetEmail({
          email: user.email,
          name: user.name,
          token
        }).pipe(Effect.mapError(() => badRequest('Failed to process forgot-password request')))

        return { accepted: true as const }
      }),

    resetPassword: (input) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort
        const passwordResetTokenPort = yield* PasswordResetTokenPort

        if (input.token.trim().length < 1 || input.password.length < 8) {
          return yield* Effect.fail(badRequest('Invalid reset-password payload'))
        }

        const tokenPrincipal = yield* passwordResetTokenPort.consumeToken(input.token).pipe(
          Effect.mapError(() => badRequest('Invalid or expired password reset token'))
        )

        if (!tokenPrincipal) {
          return yield* Effect.fail(badRequest('Invalid or expired password reset token'))
        }

        const passwordHash = yield* passwordHasher.hash(input.password).pipe(
          Effect.mapError(() => badRequest('Could not hash password'))
        )

        const updatedUser = yield* usersPort
          .updatePasswordHash(tokenPrincipal.userId, passwordHash)
          .pipe(Effect.mapError(() => badRequest('Failed to reset password')))

        if (!updatedUser) {
          return yield* Effect.fail(notFound('User not found'))
        }

        yield* passwordResetTokenPort.revokeTokensForUser(tokenPrincipal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to finalize password reset'))
        )

        return { reset: true as const }
      }),

    getPrincipalFromToken: (token: string) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const sessionTokenPort = yield* SessionTokenPort

        const payload = yield* sessionTokenPort.verify(token).pipe(
          Effect.mapError(() => unauthorized('Invalid token'))
        )

        const user = yield* usersPort.findById(payload.sub).pipe(
          Effect.mapError(() => unauthorized('Invalid token'))
        )

        if (!user) {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        if (typeof payload.pwd !== 'number') {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        if (payload.pwd < user.passwordChangedAt.getTime()) {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        return toAuthPrincipal({
          sub: user.id,
          email: user.email
        })
      }),

    deleteUser: (principal) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const organizationOwnershipPort = yield* AuthOrganizationOwnershipPort

        const existing = yield* usersPort.findById(principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to read user'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('User not found'))
        }

        const ownedOrganizationCount = yield* organizationOwnershipPort.countOwnedByUser(principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to validate organization ownership'))
        )

        if (ownedOrganizationCount > 0) {
          return yield* Effect.fail(conflict('Cannot delete account while owning organizations. Transfer ownership first.'))
        }

        const deleted = yield* usersPort.deleteById(principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to delete user'))
        )

        if (!deleted) {
          return yield* Effect.fail(notFound('User not found'))
        }

        return { deleted: true as const }
      })
  })
)
