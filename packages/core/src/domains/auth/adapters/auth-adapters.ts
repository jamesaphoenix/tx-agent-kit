import { createHash, randomBytes } from 'node:crypto'
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from '@tx-agent-kit/auth'
import { usersRepository, organizationsRepository, passwordResetTokensRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { mapNullable, toAuthUserRecord } from '../../../adapters/db-row-mappers.js'
import {
  AuthUsersPort,
  AuthOrganizationOwnershipPort,
  PasswordResetTokenPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

const hashPasswordResetToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

const createPasswordResetToken = (): string =>
  randomBytes(32).toString('base64url')

export const AuthUsersPortLive = Layer.succeed(AuthUsersPort, {
  create: (input: { email: string; passwordHash: string; name: string }) =>
    usersRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  findByEmail: (email: string) =>
    usersRepository.findByEmail(email).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  findById: (id: string) => usersRepository.findById(id).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  updatePasswordHash: (id: string, passwordHash: string) =>
    usersRepository
      .updatePasswordHash(id, passwordHash)
      .pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  deleteById: (id: string) =>
    usersRepository.deleteById(id).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord)))
})

export const AuthOrganizationOwnershipPortLive = Layer.succeed(AuthOrganizationOwnershipPort, {
  countOwnedByUser: (userId: string) => organizationsRepository.countOwnedByUser(userId)
})

export const PasswordHasherPortLive = Layer.succeed(PasswordHasherPort, {
  hash: (plainText: string) => hashPassword(plainText),
  verify: (plainText: string, hash: string) => verifyPassword(plainText, hash)
})

export const SessionTokenPortLive = Layer.succeed(SessionTokenPort, {
  sign: (payload: { sub: string; email: string; pwd: number }) => signSessionToken(payload),
  verify: (token: string) => verifySessionToken(token)
})

export const PasswordResetTokenPortLive = Layer.succeed(PasswordResetTokenPort, {
  createToken: (userId: string) =>
    Effect.gen(function* () {
      const token = createPasswordResetToken()
      const tokenHash = hashPasswordResetToken(token)

      const created = yield* passwordResetTokensRepository.create({
        userId,
        tokenHash
      })

      if (!created) {
        return yield* Effect.fail(new Error('Failed to create password reset token'))
      }

      return token
    }),

  consumeToken: (token: string) =>
    passwordResetTokensRepository.consumeByTokenHash(hashPasswordResetToken(token)),

  revokeTokensForUser: (userId: string) =>
    passwordResetTokensRepository.revokeActiveForUser(userId).pipe(Effect.asVoid)
})
