import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from '@tx-agent-kit/auth'
import { usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { mapNullable, toAuthUserRecord } from '../../../adapters/db-row-mappers.js'
import {
  AuthUsersPort,
  AuthWorkspaceOwnershipPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

export const AuthUsersPortLive = Layer.succeed(AuthUsersPort, {
  create: (input: { email: string; passwordHash: string; name: string }) =>
    usersRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  findByEmail: (email: string) =>
    usersRepository.findByEmail(email).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  findById: (id: string) => usersRepository.findById(id).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord))),
  deleteById: (id: string) =>
    usersRepository.deleteById(id).pipe(Effect.map((row) => mapNullable(row, toAuthUserRecord)))
})

export const AuthWorkspaceOwnershipPortLive = Layer.succeed(AuthWorkspaceOwnershipPort, {
  countOwnedByUser: (userId: string) => workspacesRepository.countOwnedByUser(userId)
})

export const PasswordHasherPortLive = Layer.succeed(PasswordHasherPort, {
  hash: (plainText: string) => hashPassword(plainText),
  verify: (plainText: string, hash: string) => verifyPassword(plainText, hash)
})

export const SessionTokenPortLive = Layer.succeed(SessionTokenPort, {
  sign: (payload: { sub: string; email: string }) => signSessionToken(payload),
  verify: (token: string) => verifySessionToken(token)
})
