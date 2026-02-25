import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { TeamRecord, TeamMemberRecord } from '../domain/team-domain.js'

export const TeamRepositoryKind = 'crud' as const

export type { TeamRecord, TeamMemberRecord }

export class TeamStorePort extends Context.Tag('TeamStorePort')<
  TeamStorePort,
  {
    list: (organizationId: string, params: ListParams) => Effect.Effect<PaginatedResult<TeamRecord>, unknown>
    getById: (id: string) => Effect.Effect<TeamRecord | null, unknown>
    create: (input: { organizationId: string; name: string }) => Effect.Effect<TeamRecord | null, unknown>
    update: (input: { id: string; name?: string }) => Effect.Effect<TeamRecord | null, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    addMember: (input: { teamId: string; userId: string }) => Effect.Effect<TeamMemberRecord | null, unknown>
    removeMember: (teamId: string, userId: string) => Effect.Effect<{ deleted: true }, unknown>
    listMembers: (teamId: string) => Effect.Effect<ReadonlyArray<TeamMemberRecord>, unknown>
  }
>() {}

export class TeamOrganizationMembershipPort extends Context.Tag('TeamOrganizationMembershipPort')<
  TeamOrganizationMembershipPort,
  {
    isMember: (organizationId: string, userId: string) => Effect.Effect<boolean, unknown>
  }
>() {}
