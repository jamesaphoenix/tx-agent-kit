import { Context, Effect, Layer } from 'effect'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  isValidDisplayName,
  isValidEmail,
  normalizeEmail,
  toAuthPrincipal,
  toAuthUser,
  type AuthPrincipal,
  type AuthSession,
  type SignInCommand,
  type SignUpCommand
} from '../domain/auth-domain.js'
import {
  AuthUsersPort,
  AuthWorkspaceOwnershipPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

export class AuthService extends Context.Tag('AuthService')<
  AuthService,
  {
    signUp: (input: SignUpCommand) => Effect.Effect<AuthSession, CoreError, AuthUsersPort | PasswordHasherPort | SessionTokenPort>
    signIn: (input: SignInCommand) => Effect.Effect<AuthSession, CoreError, AuthUsersPort | PasswordHasherPort | SessionTokenPort>
    getPrincipalFromToken: (token: string) => Effect.Effect<AuthPrincipal, CoreError, AuthUsersPort | SessionTokenPort>
    deleteUser: (
      principal: { userId: string }
    ) => Effect.Effect<{ deleted: true }, CoreError, AuthUsersPort | AuthWorkspaceOwnershipPort>
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
        }).pipe(Effect.mapError(() => badRequest('Sign-up failed')))

        if (!created) {
          return yield* Effect.fail(badRequest('User creation failed'))
        }

        const token = yield* sessionTokenPort.sign({
          sub: created.id,
          email: created.email
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
          email: user.email
        }).pipe(Effect.mapError(() => unauthorized('Failed to create session token')))

        return {
          token,
          user: toAuthUser(user)
        }
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

        return toAuthPrincipal({
          sub: user.id,
          email: user.email
        })
      }),

    deleteUser: (principal) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const workspaceOwnershipPort = yield* AuthWorkspaceOwnershipPort

        const existing = yield* usersPort.findById(principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to read user'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('User not found'))
        }

        const ownedWorkspaceCount = yield* workspaceOwnershipPort.countOwnedByUser(principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to validate workspace ownership'))
        )

        if (ownedWorkspaceCount > 0) {
          return yield* Effect.fail(conflict('Cannot delete account while owning workspaces. Transfer ownership first.'))
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
