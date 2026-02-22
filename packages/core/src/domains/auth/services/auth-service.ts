import type { AuthPrincipal, AuthResponse } from '@tx-agent-kit/contracts'
import { signInRequestSchema, signUpRequestSchema } from '@tx-agent-kit/contracts'
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken, toPrincipal } from '@tx-agent-kit/auth'
import { Context, Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import { toAuthUser } from '../domain/auth-domain.js'
import { AuthUsersPort, AuthWorkspaceOwnershipPort } from '../ports/auth-ports.js'

export class AuthService extends Context.Tag('AuthService')<
  AuthService,
  {
    signUp: (input: unknown) => Effect.Effect<AuthResponse, CoreError, AuthUsersPort>
    signIn: (input: unknown) => Effect.Effect<AuthResponse, CoreError, AuthUsersPort>
    getPrincipalFromToken: (token: string) => Effect.Effect<AuthPrincipal, CoreError, AuthUsersPort>
    deleteUser: (
      principal: { userId: string }
    ) => Effect.Effect<{ deleted: true }, CoreError, AuthUsersPort | AuthWorkspaceOwnershipPort>
  }
>() {}

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.succeed({
    signUp: (input: unknown) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort

        const parsed = yield* Schema.decodeUnknown(signUpRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid sign-up payload'))
        )

        const existing = yield* usersPort.findByEmail(parsed.email).pipe(
          Effect.mapError(() => badRequest('Sign-up failed'))
        )

        if (existing) {
          return yield* Effect.fail(badRequest('Sign-up failed'))
        }

        const passwordHash = yield* hashPassword(parsed.password).pipe(
          Effect.mapError(() => badRequest('Could not hash password'))
        )

        const created = yield* usersPort.create({
          email: parsed.email,
          passwordHash,
          name: parsed.name
        }).pipe(Effect.mapError(() => badRequest('Sign-up failed')))

        if (!created) {
          return yield* Effect.fail(badRequest('User creation failed'))
        }

        const token = yield* signSessionToken({
          sub: created.id,
          email: created.email
        }).pipe(Effect.mapError(() => unauthorized('Failed to create session token')))

        return {
          token,
          user: toAuthUser(created)
        }
      }),

    signIn: (input: unknown) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort

        const parsed = yield* Schema.decodeUnknown(signInRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid sign-in payload'))
        )

        const user = yield* usersPort.findByEmail(parsed.email).pipe(
          Effect.mapError(() => unauthorized('Invalid credentials'))
        )

        if (!user) {
          return yield* Effect.fail(unauthorized('Invalid credentials'))
        }

        const ok = yield* verifyPassword(parsed.password, user.passwordHash).pipe(
          Effect.mapError(() => unauthorized('Invalid credentials'))
        )

        if (!ok) {
          return yield* Effect.fail(unauthorized('Invalid credentials'))
        }

        const token = yield* signSessionToken({
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

        const payload = yield* verifySessionToken(token).pipe(
          Effect.mapError(() => unauthorized('Invalid token'))
        )

        const user = yield* usersPort.findById(payload.sub).pipe(
          Effect.mapError(() => unauthorized('Invalid token'))
        )

        if (!user) {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        return toPrincipal({
          ...payload,
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
