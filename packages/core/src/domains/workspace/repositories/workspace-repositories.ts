import { invitationsRepository, usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Layer } from 'effect'
import {
  WorkspaceInvitationStorePort,
  WorkspaceStorePort,
  WorkspaceUsersPort
} from '../ports/workspace-ports.js'

export const WorkspaceStorePortLive = Layer.succeed(WorkspaceStorePort, {
  listForUser: (userId: string) => workspacesRepository.listForUser(userId),
  create: (input: { name: string; ownerUserId: string }) => workspacesRepository.create(input),
  isMember: (workspaceId: string, userId: string) => workspacesRepository.isMember(workspaceId, userId),
  getMemberRole: (workspaceId: string, userId: string) => workspacesRepository.getMemberRole(workspaceId, userId)
})

export const WorkspaceInvitationStorePortLive = Layer.succeed(WorkspaceInvitationStorePort, {
  listForInviteeUserId: (inviteeUserId: string) => invitationsRepository.listForInviteeUserId(inviteeUserId),
  create: (input: {
    workspaceId: string
    inviteeUserId: string
    email: string
    role: 'admin' | 'member'
    invitedByUserId: string
  }) => invitationsRepository.create(input),
  acceptByToken: (token: string, userId: string) => invitationsRepository.acceptByToken(token, userId)
})

export const WorkspaceUsersPortLive = Layer.succeed(WorkspaceUsersPort, {
  findById: (id: string) => usersRepository.findById(id),
  findByEmail: (email: string) => usersRepository.findByEmail(email)
})
