import { Context } from 'effect'
import type * as Effect from 'effect/Effect'

export const WorkspaceRepositoryKind = 'custom' as const

export type WorkspaceMemberRole = 'owner' | 'admin' | 'member'
export type InvitationRole = 'owner' | 'admin' | 'member'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface WorkspaceRecord {
  id: string
  name: string
  ownerUserId: string
  createdAt: Date
}

export interface WorkspaceUserRecord {
  id: string
  email: string
  passwordHash: string
  name: string
  createdAt: Date
}

export interface InvitationRecord {
  id: string
  workspaceId: string
  inviteeUserId: string | null
  email: string
  role: InvitationRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export class WorkspaceStorePort extends Context.Tag('WorkspaceStorePort')<
  WorkspaceStorePort,
  {
    listForUser: (userId: string) => Effect.Effect<ReadonlyArray<WorkspaceRecord>, unknown>
    create: (input: { name: string; ownerUserId: string }) => Effect.Effect<WorkspaceRecord | null, unknown>
    isMember: (workspaceId: string, userId: string) => Effect.Effect<boolean, unknown>
    getMemberRole: (workspaceId: string, userId: string) => Effect.Effect<WorkspaceMemberRole | null, unknown>
  }
>() {}

export class WorkspaceInvitationStorePort extends Context.Tag('WorkspaceInvitationStorePort')<
  WorkspaceInvitationStorePort,
  {
    listForInviteeUserId: (inviteeUserId: string) => Effect.Effect<ReadonlyArray<InvitationRecord>, unknown>
    create: (input: {
      workspaceId: string
      inviteeUserId: string
      email: string
      role: 'admin' | 'member'
      invitedByUserId: string
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
