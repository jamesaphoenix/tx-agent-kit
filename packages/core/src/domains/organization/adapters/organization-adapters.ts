import { invitationsRepository, usersRepository, organizationsRepository } from '@tx-agent-kit/db'
import { Effect, Layer, Option } from 'effect'
import {
  mapOptional,
  toInvitationRecord,
  toInvitationRecordPage,
  toOrgMemberRecord,
  toOrgMemberWithUserRecordPage,
  toOrganizationRecord,
  toOrganizationRecordPage,
  toOrganizationUserRecord
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import type { DomainEventInput } from '../domain/organization-events.js'
import type { OrgMemberRole } from '../domain/organization-domain.js'
import {
  type InvitationAssignableRole,
  type InvitationStatus,
  type MembershipType,
  OrganizationMemberStorePort,
  type OrganizationRecord,
  OrganizationInvitationStorePort,
  OrganizationStorePort,
  OrganizationUsersPort
} from '../ports/organization-ports.js'

export const OrganizationStorePortLive = Layer.succeed(OrganizationStorePort, {
  list: (userId: string, params: ListParams) => organizationsRepository.list(userId, params).pipe(Effect.map(toOrganizationRecordPage)),
  listForUser: (userId: string, params: ListParams) =>
    organizationsRepository.listForUser(userId, params).pipe(Effect.map(toOrganizationRecordPage)),
  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    organizationsRepository.getManyByIdsForUser(userId, ids).pipe(Effect.map((rows) => rows.map(toOrganizationRecord))),
  getById: (id: string) => organizationsRepository.getById(id).pipe(Effect.map((opt) => mapOptional(opt, toOrganizationRecord))),
  create: (input: { name: string; ownerUserId: string }) =>
    organizationsRepository.create(input).pipe(Effect.map((opt) => mapOptional(opt, toOrganizationRecord))),
  createWithEvent: (input: { name: string; ownerUserId: string; event: DomainEventInput }) =>
    organizationsRepository.createWithEvent({
      name: input.name,
      ownerUserId: input.ownerUserId,
      event: {
        eventType: input.event.eventType,
        aggregateType: input.event.aggregateType,
        payload: input.event.payload,
        correlationId: input.event.correlationId
      }
    }).pipe(Effect.map((opt) => mapOptional(opt, toOrganizationRecord))),
  update: (input: { id: string; name?: string; onboardingData?: OrganizationRecord['onboardingData'] | null }) =>
    organizationsRepository.update(input).pipe(Effect.map((opt) => mapOptional(opt, toOrganizationRecord))),
  remove: (id: string) => organizationsRepository.remove(id).pipe(Effect.map(() => ({ deleted: true as const }))),
  removeWithEvent: (input: { id: string; event: DomainEventInput }) =>
    organizationsRepository.removeWithEvent({
      id: input.id,
      event: {
        eventType: input.event.eventType,
        aggregateType: input.event.aggregateType,
        payload: input.event.payload,
        correlationId: input.event.correlationId
      }
    }),
  isMember: (organizationId: string, userId: string) => organizationsRepository.isMember(organizationId, userId),
  getMemberRole: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(
      Effect.map((opt) => Option.map(opt, (row) => row.role))
    ),
  getMemberRolesForUser: (userId: string, organizationIds: ReadonlyArray<string>) =>
    organizationsRepository.getMemberRolesForUser(userId, organizationIds).pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.organizationId, row.role] as const)))
    )
})

export const OrganizationInvitationStorePortLive = Layer.succeed(OrganizationInvitationStorePort, {
  listForInviteeUserId: (inviteeUserId: string, inviteeEmail: string, params: ListParams) =>
    invitationsRepository.listForInviteeUserId(inviteeUserId, inviteeEmail, params).pipe(Effect.map(toInvitationRecordPage)),
  listForOrganization: (organizationId: string, params: ListParams) =>
    invitationsRepository.listForOrganization(organizationId, params).pipe(Effect.map(toInvitationRecordPage)),
  getManyByIds: (ids: ReadonlyArray<string>) =>
    invitationsRepository.getManyByIds(ids).pipe(Effect.map((rows) => rows.map(toInvitationRecord))),
  getById: (id: string) => invitationsRepository.getById(id).pipe(Effect.map((opt) => mapOptional(opt, toInvitationRecord))),
  teamBelongsToOrganization: (teamId: string, organizationId: string) =>
    invitationsRepository.teamBelongsToOrganization(teamId, organizationId),
  pendingInvitationExists: (input: { organizationId: string; email: string; teamId?: string }) =>
    invitationsRepository.pendingInvitationExists(input),
  create: (input: {
    organizationId: string
    inviteeUserId: string | null
    email: string
    role: InvitationAssignableRole
    invitedByUserId: string
    teamId?: string
    membershipType?: MembershipType
  }) => invitationsRepository.create(input).pipe(Effect.map((opt) => mapOptional(opt, toInvitationRecord))),
  updateById: (input: {
    id: string
    role?: InvitationAssignableRole
    status?: InvitationStatus
    revokedByUserId?: string
  }) => invitationsRepository.updateById(input).pipe(Effect.map((opt) => mapOptional(opt, toInvitationRecord))),
  acceptByToken: (token: string, userId: string, email: string) =>
    invitationsRepository.acceptByToken(token, userId, email).pipe(Effect.map((opt) => mapOptional(opt, toInvitationRecord)))
})

export const OrganizationUsersPortLive = Layer.succeed(OrganizationUsersPort, {
  findById: (id: string) => usersRepository.findById(id).pipe(Effect.map((opt) => mapOptional(opt, toOrganizationUserRecord))),
  findByEmail: (email: string) =>
    usersRepository.findByEmail(email).pipe(Effect.map((opt) => mapOptional(opt, toOrganizationUserRecord)))
})

export const OrganizationMemberStorePortLive = Layer.succeed(OrganizationMemberStorePort, {
  listMembers: (organizationId: string, params: ListParams) =>
    organizationsRepository.listMembers(organizationId, params).pipe(Effect.map(toOrgMemberWithUserRecordPage)),
  getMemberById: (memberId: string) =>
    organizationsRepository.getMemberById(memberId).pipe(Effect.map((opt) => mapOptional(opt, toOrgMemberRecord))),
  // Note: organizationsRepository.getMemberRole returns the full org_members row
  // (including disabledAt, membershipType, etc.), not just the role string.
  // The name is misleading but the underlying query selects all orgMemberSelectColumns.
  getMember: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(Effect.map((opt) => mapOptional(opt, toOrgMemberRecord))),
  addMember: (input: { organizationId: string; userId: string; role: OrgMemberRole }) =>
    organizationsRepository.addMember(input).pipe(Effect.map((opt) => mapOptional(opt, toOrgMemberRecord))),
  countActiveAdmins: (organizationId: string) =>
    organizationsRepository.countActiveAdmins(organizationId),
  updateMemberRole: (memberId: string, role: OrgMemberRole) =>
    organizationsRepository.updateMemberRole(memberId, role).pipe(Effect.map((opt) => mapOptional(opt, toOrgMemberRecord))),
  disableMember: (memberId: string) =>
    organizationsRepository.disableMember(memberId).pipe(Effect.map((opt) => mapOptional(opt, toOrgMemberRecord))),
  enableMember: (memberId: string) =>
    organizationsRepository.enableMember(memberId).pipe(Effect.map((opt) => mapOptional(opt, toOrgMemberRecord))),
  removeMember: (memberId: string) =>
    organizationsRepository.removeMember(memberId),
  transferOwnership: (input: { organizationId: string; fromUserId: string; toUserId: string }) =>
    organizationsRepository.transferOwnership(input)
})
