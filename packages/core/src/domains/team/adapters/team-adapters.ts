import { organizationsRepository, teamsRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import {
  mapNullable,
  toTeamMemberRecord,
  toTeamRecord,
  toTeamRecordPage
} from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import { TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'

export const TeamStorePortLive = Layer.succeed(TeamStorePort, {
  list: (organizationId: string, params: ListParams) =>
    teamsRepository.list(organizationId, params).pipe(Effect.map(toTeamRecordPage)),
  getById: (id: string) =>
    teamsRepository.getById(id).pipe(Effect.map((row) => mapNullable(row, toTeamRecord))),
  create: (input: { organizationId: string; name: string }) =>
    teamsRepository.create(input).pipe(Effect.map((row) => mapNullable(row, toTeamRecord))),
  update: (input: { id: string; name?: string }) =>
    teamsRepository.update(input).pipe(Effect.map((row) => mapNullable(row, toTeamRecord))),
  remove: (id: string) =>
    teamsRepository.remove(id).pipe(Effect.map(() => ({ deleted: true as const }))),
  addMember: (input: { teamId: string; userId: string }) =>
    teamsRepository.addMember(input).pipe(Effect.map((row) => mapNullable(row, toTeamMemberRecord))),
  removeMember: (teamId: string, userId: string) =>
    teamsRepository.removeMember(teamId, userId).pipe(Effect.map(() => ({ deleted: true as const }))),
  listMembers: (teamId: string) =>
    teamsRepository.listMembers(teamId).pipe(Effect.map((rows) => rows.map(toTeamMemberRecord)))
})

export const TeamOrganizationMembershipPortLive = Layer.succeed(TeamOrganizationMembershipPort, {
  isMember: (organizationId: string, userId: string) => organizationsRepository.isMember(organizationId, userId)
})
