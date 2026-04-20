import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { BrandSettingsShape, ContentReviewTokenRecord, TeamRecord, TeamMemberRecord } from '../domain/team-domain.js'
import type { DomainEventInput } from '../../../domain-event-types.js'

export const TeamRepositoryKind = 'crud' as const

export type { TeamRecord, TeamMemberRecord, ContentReviewTokenRecord }

export class ContentReviewTokenStorePort extends Context.Tag('ContentReviewTokenStorePort')<
  ContentReviewTokenStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<ContentReviewTokenRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    create: (input: {
      teamId: string
      expiresAt: Date
      permissions: string[]
      reviewerName?: string | null
      reviewerEmail?: string | null
      createdBy: string
    }) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    findByToken: (token: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    revoke: (id: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    touchLastAccessed: (id: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
  }
>() {}

export class TeamStorePort extends Context.Tag('TeamStorePort')<
  TeamStorePort,
  {
    list: (organizationId: string, params: ListParams) => Effect.Effect<PaginatedResult<TeamRecord>, unknown>
    listForMember: (
      organizationId: string,
      userId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<TeamRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<TeamRecord>, unknown>
    create: (input: { organizationId: string; name: string; website?: string | null; brandSettings?: BrandSettingsShape | null }) => Effect.Effect<Option.Option<TeamRecord>, unknown>
    update: (input: { id: string; name?: string; website?: string | null; brandSettings?: BrandSettingsShape | null }) => Effect.Effect<Option.Option<TeamRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    removeWithEvent: (input: {
      id: string
      event: DomainEventInput
    }) => Effect.Effect<{ deleted: true }, unknown>
    addMember: (input: { teamId: string; userId: string; role?: TeamMemberRecord['role'] }) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    removeMember: (teamId: string, userId: string) => Effect.Effect<{ deleted: true }, unknown>
    listMembers: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<TeamMemberRecord>, unknown>
    getMemberByTeamAndUser: (teamId: string, userId: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    getMemberById: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    updateMemberRole: (id: string, roleId: string | null) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    disableMemberById: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    enableMemberById: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    removeMemberById: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
  }
>() {}

export class TeamOrganizationMembershipPort extends Context.Tag('TeamOrganizationMembershipPort')<
  TeamOrganizationMembershipPort,
  {
    isMember: (organizationId: string, userId: string) => Effect.Effect<boolean, unknown>
    getOrgMemberDisabledAt: (organizationId: string, userId: string) => Effect.Effect<Date | null, unknown>
    getMemberRole: (organizationId: string, userId: string) => Effect.Effect<string | null, unknown>
  }
>() {}
