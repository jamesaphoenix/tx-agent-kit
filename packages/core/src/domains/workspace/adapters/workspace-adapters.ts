import { invitationsRepository, usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import {
  mapNullable,
  toInvitationRecord,
  toInvitationRecordPage,
  toWorkspaceRecord,
  toWorkspaceRecordPage,
  toWorkspaceUserRecord
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import {
  type InvitationAssignableRole,
  type InvitationStatus,
  WorkspaceInvitationStorePort,
  WorkspaceStorePort,
  WorkspaceUsersPort
} from '../ports/workspace-ports.js'

export const WorkspaceStorePortLive = Layer.succeed(WorkspaceStorePort, {
  list: (userId: string, params: ListParams) => workspacesRepository.list(userId, params).pipe(Effect.map(toWorkspaceRecordPage)),
  listForUser: (userId: string, params: ListParams) =>
    workspacesRepository.listForUser(userId, params).pipe(Effect.map(toWorkspaceRecordPage)),
  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    workspacesRepository.getManyByIdsForUser(userId, ids).pipe(Effect.map((rows) => rows.map(toWorkspaceRecord))),
  getById: (id: string) => workspacesRepository.getById(id).pipe(Effect.map((row) => mapNullable(row, toWorkspaceRecord))),
  create: (input: { name: string; ownerUserId: string }) =>
    workspacesRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toWorkspaceRecord))),
  update: (input: { id: string; name?: string }) =>
    workspacesRepository.update(input).pipe(Effect.map((row) => mapNullable(row, toWorkspaceRecord))),
  remove: (id: string) => workspacesRepository.remove(id),
  isMember: (workspaceId: string, userId: string) => workspacesRepository.isMember(workspaceId, userId),
  getMemberRole: (workspaceId: string, userId: string) => workspacesRepository.getMemberRole(workspaceId, userId),
  getMemberRolesForUser: (userId: string, workspaceIds: ReadonlyArray<string>) =>
    workspacesRepository.getMemberRolesForUser(userId, workspaceIds)
})

export const WorkspaceInvitationStorePortLive = Layer.succeed(WorkspaceInvitationStorePort, {
  listForInviteeUserId: (inviteeUserId: string, params: ListParams) =>
    invitationsRepository.listForInviteeUserId(inviteeUserId, params).pipe(Effect.map(toInvitationRecordPage)),
  getManyByIds: (ids: ReadonlyArray<string>) =>
    invitationsRepository.getManyByIds(ids).pipe(Effect.map((rows) => rows.map(toInvitationRecord))),
  getById: (id: string) => invitationsRepository.getById(id).pipe(Effect.map((row) => mapNullable(row, toInvitationRecord))),
  create: (input: {
    workspaceId: string
    inviteeUserId: string
    email: string
    role: InvitationAssignableRole
    invitedByUserId: string
  }) => invitationsRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toInvitationRecord))),
  updateById: (input: {
    id: string
    role?: InvitationAssignableRole
    status?: InvitationStatus
  }) => invitationsRepository.updateById(input).pipe(Effect.map((row) => mapNullable(row, toInvitationRecord))),
  acceptByToken: (token: string, userId: string) =>
    invitationsRepository.acceptByToken(token, userId).pipe(Effect.map((row) => mapNullable(row, toInvitationRecord)))
})

export const WorkspaceUsersPortLive = Layer.succeed(WorkspaceUsersPort, {
  findById: (id: string) => usersRepository.findById(id).pipe(Effect.map((row) => mapNullable(row, toWorkspaceUserRecord))),
  findByEmail: (email: string) =>
    usersRepository.findByEmail(email).pipe(Effect.map((row) => mapNullable(row, toWorkspaceUserRecord)))
})
