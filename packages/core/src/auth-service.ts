import type { AuthPrincipal, AuthResponse, User } from '@tx-agent-kit/contracts'
import { signInRequestSchema, signUpRequestSchema } from '@tx-agent-kit/contracts'
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken, toPrincipal } from '@tx-agent-kit/auth'
import { usersRepository } from '@tx-agent-kit/db'
import { Context, Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from './errors.js'

const toUser = (row: { id: string; email: string; name: string; createdAt: Date }): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt.toISOString()
})

export class AuthService extends Context.Tag('AuthService')<
  AuthService,
  {
    signUp: (input: unknown) => Effect.Effect<AuthResponse, CoreError>
    signIn: (input: unknown) => Effect.Effect<AuthResponse, CoreError>
    getPrincipalFromToken: (token: string) => Effect.Effect<AuthPrincipal, CoreError>
    deleteUser: (principal: { userId: string }) => Effect.Effect<{ deleted: true }, CoreError>
  }
>() {}

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.succeed({
    signUp: (input: unknown) =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(signUpRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid sign-up payload'))
        )

        const existing = yield* Effect.tryPromise({
          try: () => usersRepository.findByEmail(parsed.email),
          catch: () => badRequest('Failed to read user')
        })

        if (existing) {
          return yield* Effect.fail(conflict('User already exists'))
        }

        const passwordHash = yield* hashPassword(parsed.password).pipe(
          Effect.mapError(() => badRequest('Could not hash password'))
        )

        const created = yield* Effect.tryPromise({
          try: () => usersRepository.create({
            email: parsed.email,
            passwordHash,
            name: parsed.name
          }),
          catch: () => badRequest('Failed to create user')
        })

        if (!created) {
          return yield* Effect.fail(badRequest('User creation failed'))
        }

        const token = yield* signSessionToken({
          sub: created.id,
          email: created.email
        }).pipe(Effect.mapError(() => unauthorized('Failed to create session token')))

        return {
          token,
          user: toUser(created)
        }
      }),

    signIn: (input: unknown) =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(signInRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid sign-in payload'))
        )

        const user = yield* Effect.tryPromise({
          try: () => usersRepository.findByEmail(parsed.email),
          catch: () => unauthorized('Invalid credentials')
        })

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
          user: toUser(user)
        }
      }),

    getPrincipalFromToken: (token: string) =>
      verifySessionToken(token).pipe(
        Effect.map(toPrincipal),
        Effect.mapError(() => unauthorized('Invalid token'))
      ),

    deleteUser: (principal) =>
      Effect.gen(function* () {
        const existing = yield* Effect.tryPromise({
          try: () => usersRepository.findById(principal.userId),
          catch: () => badRequest('Failed to read user')
        })

        if (!existing) {
          return yield* Effect.fail(notFound('User not found'))
        }

        const deleted = yield* Effect.tryPromise({
          try: () => usersRepository.deleteById(principal.userId),
          catch: () => badRequest('Failed to delete user')
        })

        if (!deleted) {
          return yield* Effect.fail(notFound('User not found'))
        }

        return { deleted: true as const }
      })
  })
)
