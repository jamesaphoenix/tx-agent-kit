import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { DomainEventInput } from '../domain/organization-events.js'
import type {
  InvitationAssignableRole,
  InvitationRole,
  InvitationRecord,
  InvitationStatus,
  MembershipType,
  OrgMemberRecord,
  OrgMemberRole,
  OrganizationRecord,
  OrganizationUserRecord
} from '../domain/organization-domain.js'

export const OrganizationRepositoryKind = 'crud' as const

export type {
  InvitationAssignableRole,
  OrgMemberRecord,
  OrgMemberRole,
  InvitationRole,
  InvitationStatus,
  MembershipType,
  OrganizationRecord,
  OrganizationUserRecord,
  InvitationRecord,
  DomainEventInput
}

export class OrganizationStorePort extends Context.Tag('OrganizationStorePort')<
  OrganizationStorePort,
  {
    list: (userId: string, params: ListParams) => Effect.Effect<PaginatedResult<OrganizationRecord>, unknown>
    listForUser: (userId: string, params: ListParams) => Effect.Effect<PaginatedResult<OrganizationRecord>, unknown>
    getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<OrganizationRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<OrganizationRecord>, unknown>
    create: (input: { name: string; ownerUserId: string }) => Effect.Effect<Option.Option<OrganizationRecord>, unknown>
    createWithEvent: (input: {
      name: string
      ownerUserId: string
      event: DomainEventInput
    }) => Effect.Effect<Option.Option<OrganizationRecord>, unknown>
    update: (
      input: {
        id: string
        name?: string
        onboardingData?: OrganizationRecord['onboardingData'] | null
      }
    ) => Effect.Effect<Option.Option<OrganizationRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    removeWithEvent: (input: {
      id: string
      event: DomainEventInput
    }) => Effect.Effect<{ deleted: true }, unknown>
    isMember: (organizationId: string, userId: string) => Effect.Effect<boolean, unknown>
    getMemberRole: (organizationId: string, userId: string) => Effect.Effect<Option.Option<OrgMemberRole>, unknown>
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
      inviteeEmail: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<InvitationRecord>, unknown>
    listForOrganization: (
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<InvitationRecord>, unknown>
    getManyByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<InvitationRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<InvitationRecord>, unknown>
    teamBelongsToOrganization: (teamId: string, organizationId: string) => Effect.Effect<boolean, unknown>
    pendingInvitationExists: (input: {
      organizationId: string
      email: string
      teamId?: string
    }) => Effect.Effect<boolean, unknown>
    create: (input: {
      organizationId: string
      inviteeUserId: string | null
      email: string
      role: InvitationAssignableRole
      invitedByUserId: string
      teamId?: string
      membershipType?: MembershipType
    }) => Effect.Effect<Option.Option<InvitationRecord>, unknown>
    updateById: (input: {
      id: string
      role?: InvitationAssignableRole
      status?: InvitationStatus
      revokedByUserId?: string
    }) => Effect.Effect<Option.Option<InvitationRecord>, unknown>
    acceptByToken: (
      token: string,
      userId: string,
      email: string
    ) => Effect.Effect<Option.Option<InvitationRecord>, unknown>
  }
>() {}

export class OrganizationUsersPort extends Context.Tag('OrganizationUsersPort')<
  OrganizationUsersPort,
  {
    findById: (id: string) => Effect.Effect<Option.Option<OrganizationUserRecord>, unknown>
    findByEmail: (email: string) => Effect.Effect<Option.Option<OrganizationUserRecord>, unknown>
  }
>() {}

export class OrganizationMemberStorePort extends Context.Tag('OrganizationMemberStorePort')<
  OrganizationMemberStorePort,
  {
    listMembers: (organizationId: string, params: ListParams) => Effect.Effect<PaginatedResult<OrgMemberRecord>, unknown>
    getMemberById: (memberId: string) => Effect.Effect<Option.Option<OrgMemberRecord>, unknown>
    getMember: (organizationId: string, userId: string) => Effect.Effect<Option.Option<OrgMemberRecord>, unknown>
    addMember: (input: { organizationId: string; userId: string; role: OrgMemberRole }) => Effect.Effect<Option.Option<OrgMemberRecord>, unknown>
    countActiveAdmins: (organizationId: string) => Effect.Effect<number, unknown>
    updateMemberRole: (memberId: string, role: OrgMemberRole) => Effect.Effect<Option.Option<OrgMemberRecord>, unknown>
    disableMember: (memberId: string) => Effect.Effect<Option.Option<OrgMemberRecord>, unknown>
    enableMember: (memberId: string) => Effect.Effect<Option.Option<OrgMemberRecord>, unknown>
    removeMember: (memberId: string) => Effect.Effect<{ deleted: true }, unknown>
    transferOwnership: (input: {
      organizationId: string
      fromUserId: string
      toUserId: string
    }) => Effect.Effect<{ transferred: true }, unknown>
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
