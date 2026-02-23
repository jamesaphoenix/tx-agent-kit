import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from '@tx-agent-kit/auth'
import { usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Layer } from 'effect'
import {
  AuthUsersPort,
  AuthWorkspaceOwnershipPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

export const AuthUsersPortLive = Layer.succeed(AuthUsersPort, {
  create: (input: { email: string; passwordHash: string; name: string }) => usersRepository.create(input),
  findByEmail: (email: string) => usersRepository.findByEmail(email),
  findById: (id: string) => usersRepository.findById(id),
  deleteById: (id: string) => usersRepository.deleteById(id)
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
