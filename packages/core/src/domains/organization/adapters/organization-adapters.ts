import { invitationsRepository, usersRepository, organizationsRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import {
  mapNullable,
  toInvitationRecord,
  toInvitationRecordPage,
  toOrganizationRecord,
  toOrganizationRecordPage,
  toOrganizationUserRecord
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import {
  type InvitationAssignableRole,
  type InvitationStatus,
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
  getById: (id: string) => organizationsRepository.getById(id).pipe(Effect.map((row) => mapNullable(row, toOrganizationRecord))),
  create: (input: { name: string; ownerUserId: string }) =>
    organizationsRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toOrganizationRecord))),
  update: (input: { id: string; name?: string; onboardingData?: OrganizationRecord['onboardingData'] | null }) =>
    organizationsRepository.update(input).pipe(Effect.map((row) => mapNullable(row, toOrganizationRecord))),
  remove: (id: string) => organizationsRepository.remove(id).pipe(Effect.map(() => ({ deleted: true as const }))),
  isMember: (organizationId: string, userId: string) => organizationsRepository.isMember(organizationId, userId),
  getMemberRole: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(
      Effect.map((row) => (row ? row.role : null))
    ),
  getMemberRolesForUser: (userId: string, organizationIds: ReadonlyArray<string>) =>
    organizationsRepository.getMemberRolesForUser(userId, organizationIds).pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.organizationId, row.role] as const)))
    )
})

export const OrganizationInvitationStorePortLive = Layer.succeed(OrganizationInvitationStorePort, {
  listForInviteeUserId: (inviteeUserId: string, params: ListParams) =>
    invitationsRepository.listForInviteeUserId(inviteeUserId, params).pipe(Effect.map(toInvitationRecordPage)),
  getManyByIds: (ids: ReadonlyArray<string>) =>
    invitationsRepository.getManyByIds(ids).pipe(Effect.map((rows) => rows.map(toInvitationRecord))),
  getById: (id: string) => invitationsRepository.getById(id).pipe(Effect.map((row) => mapNullable(row, toInvitationRecord))),
  create: (input: {
    organizationId: string
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

export const OrganizationUsersPortLive = Layer.succeed(OrganizationUsersPort, {
  findById: (id: string) => usersRepository.findById(id).pipe(Effect.map((row) => mapNullable(row, toOrganizationUserRecord))),
  findByEmail: (email: string) =>
    usersRepository.findByEmail(email).pipe(Effect.map((row) => mapNullable(row, toOrganizationUserRecord)))
})
