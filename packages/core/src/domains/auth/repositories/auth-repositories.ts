import { usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Layer } from 'effect'
import { AuthUsersPort, AuthWorkspaceOwnershipPort } from '../ports/auth-ports.js'

export const AuthUsersPortLive = Layer.succeed(AuthUsersPort, {
  create: (input: { email: string; passwordHash: string; name: string }) => usersRepository.create(input),
  findByEmail: (email: string) => usersRepository.findByEmail(email),
  findById: (id: string) => usersRepository.findById(id),
  deleteById: (id: string) => usersRepository.deleteById(id)
})

export const AuthWorkspaceOwnershipPortLive = Layer.succeed(AuthWorkspaceOwnershipPort, {
  countOwnedByUser: (userId: string) => workspacesRepository.countOwnedByUser(userId)
})
