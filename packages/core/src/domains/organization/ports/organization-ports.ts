import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type {
  InvitationAssignableRole,
  InvitationRole,
  InvitationRecord,
  InvitationStatus,
  OrgMemberRole,
  OrganizationRecord,
  OrganizationUserRecord
} from '../domain/organization-domain.js'

export const OrganizationRepositoryKind = 'crud' as const

export type {
  InvitationAssignableRole,
  OrgMemberRole,
  InvitationRole,
  InvitationStatus,
  OrganizationRecord,
  OrganizationUserRecord,
  InvitationRecord
}

export class OrganizationStorePort extends Context.Tag('OrganizationStorePort')<
  OrganizationStorePort,
  {
    list: (userId: string, params: ListParams) => Effect.Effect<PaginatedResult<OrganizationRecord>, unknown>
    listForUser: (userId: string, params: ListParams) => Effect.Effect<PaginatedResult<OrganizationRecord>, unknown>
    getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<OrganizationRecord>, unknown>
    getById: (id: string) => Effect.Effect<OrganizationRecord | null, unknown>
    create: (input: { name: string; ownerUserId: string }) => Effect.Effect<OrganizationRecord | null, unknown>
    update: (
      input: {
        id: string
        name?: string
        onboardingData?: OrganizationRecord['onboardingData'] | null
      }
    ) => Effect.Effect<OrganizationRecord | null, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    isMember: (organizationId: string, userId: string) => Effect.Effect<boolean, unknown>
    getMemberRole: (organizationId: string, userId: string) => Effect.Effect<OrgMemberRole | null, unknown>
    getMemberRolesForUser: (
      userId: string,
      organizationIds: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyMap<string, OrgMemberRole>, unknown>
  }
>() {}

export class OrganizationInvitationStorePort extends Context.Tag('OrganizationInvitationStorePort')<
  OrganizationInvitationStorePort,
  {
    listForInviteeUserId: (
      inviteeUserId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<InvitationRecord>, unknown>
    getManyByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<InvitationRecord>, unknown>
    getById: (id: string) => Effect.Effect<InvitationRecord | null, unknown>
    create: (input: {
      organizationId: string
      inviteeUserId: string
      email: string
      role: InvitationAssignableRole
      invitedByUserId: string
    }) => Effect.Effect<InvitationRecord | null, unknown>
    updateById: (input: {
      id: string
      role?: InvitationAssignableRole
      status?: InvitationStatus
    }) => Effect.Effect<InvitationRecord | null, unknown>
    acceptByToken: (token: string, userId: string) => Effect.Effect<InvitationRecord | null, unknown>
  }
>() {}

export class OrganizationUsersPort extends Context.Tag('OrganizationUsersPort')<
  OrganizationUsersPort,
  {
    findById: (id: string) => Effect.Effect<OrganizationUserRecord | null, unknown>
    findByEmail: (email: string) => Effect.Effect<OrganizationUserRecord | null, unknown>
  }
>() {}

export class InvitationEmailPort extends Context.Tag('InvitationEmailPort')<
  InvitationEmailPort,
  {
    sendInvitationEmail: (input: {
      recipientEmail: string
      recipientName: string
      organizationName: string
      inviterName: string
      role: string
      token: string
    }) => Effect.Effect<void, unknown>
  }
>() {}
