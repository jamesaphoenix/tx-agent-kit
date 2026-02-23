import { invitationsRepository, usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Layer } from 'effect'
import type { ListParams } from '../../../pagination.js'
import {
  WorkspaceInvitationStorePort,
  WorkspaceStorePort,
  WorkspaceUsersPort
} from '../ports/workspace-ports.js'

export const WorkspaceStorePortLive = Layer.succeed(WorkspaceStorePort, {
  list: (userId: string, params: ListParams) => workspacesRepository.list(userId, params),
  listForUser: (userId: string, params: ListParams) => workspacesRepository.listForUser(userId, params),
  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) => workspacesRepository.getManyByIdsForUser(userId, ids),
  getById: (id: string) => workspacesRepository.getById(id),
  create: (input: { name: string; ownerUserId: string }) => workspacesRepository.create(input),
  update: (input: { id: string; name?: string }) => workspacesRepository.update(input),
  remove: (id: string) => workspacesRepository.remove(id),
  isMember: (workspaceId: string, userId: string) => workspacesRepository.isMember(workspaceId, userId),
  getMemberRole: (workspaceId: string, userId: string) => workspacesRepository.getMemberRole(workspaceId, userId),
  getMemberRolesForUser: (userId: string, workspaceIds: ReadonlyArray<string>) =>
    workspacesRepository.getMemberRolesForUser(userId, workspaceIds)
})

export const WorkspaceInvitationStorePortLive = Layer.succeed(WorkspaceInvitationStorePort, {
  listForInviteeUserId: (inviteeUserId: string, params: ListParams) =>
    invitationsRepository.listForInviteeUserId(inviteeUserId, params),
  getManyByIds: (ids: ReadonlyArray<string>) => invitationsRepository.getManyByIds(ids),
  getById: (id: string) => invitationsRepository.getById(id),
  create: (input: {
    workspaceId: string
    inviteeUserId: string
    email: string
    role: 'admin' | 'member'
    invitedByUserId: string
  }) => invitationsRepository.create(input),
  updateById: (input: {
    id: string
    role?: 'admin' | 'member'
    status?: 'pending' | 'accepted' | 'revoked' | 'expired'
  }) => invitationsRepository.updateById(input),
  acceptByToken: (token: string, userId: string) => invitationsRepository.acceptByToken(token, userId)
})

export const WorkspaceUsersPortLive = Layer.succeed(WorkspaceUsersPort, {
  findById: (id: string) => usersRepository.findById(id),
  findByEmail: (email: string) => usersRepository.findByEmail(email)
})
