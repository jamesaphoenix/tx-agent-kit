import { contentReviewTokensRepository, organizationsRepository, teamsRepository } from '@tx-agent-kit/db'
import { Effect, Layer, Option } from 'effect'
import type { DomainEventInput } from '../../../domain-event-types.js'
import {
  mapOptional,
  toContentReviewTokenRecord,
  toContentReviewTokenRecordPage,
  toTeamMemberRecord,
  toTeamMemberRecordPage,
  toTeamRecord,
  toTeamRecordPage
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import type { BrandSettingsShape } from '../domain/team-domain.js'
import { ContentReviewTokenStorePort, TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'

export const TeamStorePortLive = Layer.succeed(TeamStorePort, {
  list: (organizationId: string, params: ListParams) =>
    teamsRepository.list(organizationId, params).pipe(Effect.map(toTeamRecordPage)),
  listForMember: (organizationId: string, userId: string, params: ListParams) =>
    teamsRepository.listForMember(organizationId, userId, params).pipe(Effect.map(toTeamRecordPage)),
  getById: (id: string) =>
    teamsRepository.getById(id).pipe(Effect.map((row) => mapOptional(row, toTeamRecord))),
  create: (input: { organizationId: string; name: string; website?: string | null; brandSettings?: BrandSettingsShape | null }) =>
    teamsRepository.create(input).pipe(Effect.map((row) => mapOptional(row, toTeamRecord))),
  update: (input: { id: string; name?: string; website?: string | null; brandSettings?: BrandSettingsShape | null }) =>
    teamsRepository.update(input).pipe(Effect.map((row) => mapOptional(row, toTeamRecord))),
  remove: (id: string) =>
    teamsRepository.remove(id).pipe(Effect.map(() => ({ deleted: true as const }))),
  removeWithEvent: (input: { id: string; event: DomainEventInput }) =>
    teamsRepository.removeWithEvent({
      id: input.id,
      event: {
        eventType: input.event.eventType,
        aggregateType: input.event.aggregateType,
        payload: input.event.payload,
        correlationId: input.event.correlationId
      }
    }),
  addMember: (input: { teamId: string; userId: string }) =>
    teamsRepository.addMember(input).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord))),
  removeMember: (teamId: string, userId: string) =>
    teamsRepository.removeMember(teamId, userId).pipe(Effect.map(() => ({ deleted: true as const }))),
  listMembers: (teamId: string, params: ListParams) =>
    teamsRepository.listMembers(teamId, params).pipe(Effect.map(toTeamMemberRecordPage)),
  getMemberByTeamAndUser: (teamId: string, userId: string) =>
    teamsRepository.getMemberByTeamAndUser(teamId, userId).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord))),
  getMemberById: (id: string) =>
    teamsRepository.getMemberById(id).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord))),
  updateMemberRole: (id: string, roleId: string | null) =>
    teamsRepository.updateMemberRole(id, roleId).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord))),
  disableMemberById: (id: string) =>
    teamsRepository.disableMemberById(id).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord))),
  enableMemberById: (id: string) =>
    teamsRepository.enableMemberById(id).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord))),
  removeMemberById: (id: string) =>
    teamsRepository.removeMemberById(id).pipe(Effect.map((row) => mapOptional(row, toTeamMemberRecord)))
})

export const TeamOrganizationMembershipPortLive = Layer.succeed(TeamOrganizationMembershipPort, {
  isMember: (organizationId: string, userId: string) => organizationsRepository.isMember(organizationId, userId),
  getOrgMemberDisabledAt: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(
      Effect.map((opt) => Option.match(opt, { onNone: () => null, onSome: (row) => row.disabledAt ?? null }))
    ),
  getMemberRole: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(
      Effect.map((opt) => Option.match(opt, { onNone: () => null, onSome: (row) => row.role }))
    )
})

export const ContentReviewTokenStorePortLive = Layer.succeed(ContentReviewTokenStorePort, {
  list: (teamId: string, params: ListParams) =>
    contentReviewTokensRepository.list(teamId, params).pipe(Effect.map(toContentReviewTokenRecordPage)),
  getById: (id: string) =>
    contentReviewTokensRepository.getById(id).pipe(Effect.map((row) => mapOptional(row, toContentReviewTokenRecord))),
  create: (input: {
    teamId: string
    expiresAt: Date
    permissions: string[]
    reviewerName?: string | null
    reviewerEmail?: string | null
    createdBy: string
  }) => contentReviewTokensRepository.create(input).pipe(Effect.map((row) => mapOptional(row, toContentReviewTokenRecord))),
  findByToken: (token: string) =>
    contentReviewTokensRepository.findByToken(token).pipe(Effect.map((row) => mapOptional(row, toContentReviewTokenRecord))),
  revoke: (id: string) =>
    contentReviewTokensRepository.revoke(id).pipe(Effect.map((row) => mapOptional(row, toContentReviewTokenRecord))),
  touchLastAccessed: (id: string) =>
    contentReviewTokensRepository.touchLastAccessed(id).pipe(Effect.map((row) => mapOptional(row, toContentReviewTokenRecord)))
})
