import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type {
  InvitationRole,
  InvitationRecord,
  InvitationStatus,
  WorkspaceMemberRole,
  WorkspaceRecord,
  WorkspaceUserRecord
} from '../domain/workspace-domain.js'

export const WorkspaceRepositoryKind = 'crud' as const

export type {
  WorkspaceMemberRole,
  InvitationRole,
  InvitationStatus,
  WorkspaceRecord,
  WorkspaceUserRecord,
  InvitationRecord
}

export class WorkspaceStorePort extends Context.Tag('WorkspaceStorePort')<
  WorkspaceStorePort,
  {
    list: (userId: string, params: ListParams) => Effect.Effect<PaginatedResult<WorkspaceRecord>, unknown>
    listForUser: (userId: string, params: ListParams) => Effect.Effect<PaginatedResult<WorkspaceRecord>, unknown>
    getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<WorkspaceRecord>, unknown>
    getById: (id: string) => Effect.Effect<WorkspaceRecord | null, unknown>
    create: (input: { name: string; ownerUserId: string }) => Effect.Effect<WorkspaceRecord | null, unknown>
    update: (input: { id: string; name?: string }) => Effect.Effect<WorkspaceRecord | null, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    isMember: (workspaceId: string, userId: string) => Effect.Effect<boolean, unknown>
    getMemberRole: (workspaceId: string, userId: string) => Effect.Effect<WorkspaceMemberRole | null, unknown>
    getMemberRolesForUser: (
      userId: string,
      workspaceIds: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyMap<string, WorkspaceMemberRole>, unknown>
  }
>() {}

export class WorkspaceInvitationStorePort extends Context.Tag('WorkspaceInvitationStorePort')<
  WorkspaceInvitationStorePort,
  {
    listForInviteeUserId: (
      inviteeUserId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<InvitationRecord>, unknown>
    getManyByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<InvitationRecord>, unknown>
    getById: (id: string) => Effect.Effect<InvitationRecord | null, unknown>
    create: (input: {
      workspaceId: string
      inviteeUserId: string
      email: string
      role: 'admin' | 'member'
      invitedByUserId: string
    }) => Effect.Effect<InvitationRecord | null, unknown>
    updateById: (input: {
      id: string
      role?: 'admin' | 'member'
      status?: InvitationStatus
    }) => Effect.Effect<InvitationRecord | null, unknown>
    acceptByToken: (token: string, userId: string) => Effect.Effect<InvitationRecord | null, unknown>
  }
>() {}

export class WorkspaceUsersPort extends Context.Tag('WorkspaceUsersPort')<
  WorkspaceUsersPort,
  {
    findById: (id: string) => Effect.Effect<WorkspaceUserRecord | null, unknown>
    findByEmail: (email: string) => Effect.Effect<WorkspaceUserRecord | null, unknown>
  }
>() {}
