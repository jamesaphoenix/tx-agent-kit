import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, conflict, forbidden, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import {
  isValidBrandSettings,
  isValidTeamName,
  normalizeTeamName,
  type CreateTeamCommand,
  type TeamRecord,
  type TeamMemberRecord,
  type UpdateTeamCommand
} from '../domain/team-domain.js'
import {
  ContentReviewTokenStorePort,
  type ContentReviewTokenRecord,
  TeamStorePort,
  TeamOrganizationMembershipPort
} from '../ports/team-ports.js'

export class TeamService extends Context.Tag('TeamService')<
  TeamService,
  {
    listForOrganization: (
      principal: { userId: string },
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<TeamRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    getById: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<TeamRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    create: (
      principal: { userId: string },
      input: CreateTeamCommand
    ) => Effect.Effect<TeamRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    update: (
      principal: { userId: string },
      id: string,
      input: UpdateTeamCommand
    ) => Effect.Effect<TeamRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    remove: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    addMember: (
      principal: { userId: string },
      teamId: string,
      userId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    removeMember: (
      principal: { userId: string },
      teamId: string,
      userId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    listMembers: (
      principal: { userId: string },
      teamId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<TeamMemberRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    addMemberById: (
      principal: { userId: string },
      teamId: string,
      userId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    getMemberById: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    updateMemberRole: (
      principal: { userId: string },
      teamId: string,
      memberId: string,
      roleId: string | null
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    disableTeamMember: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    enableTeamMember: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    removeTeamMember: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    createReviewToken: (
      principal: { userId: string },
      teamId: string,
      input: {
        permissions: string[]
        reviewerName?: string | null
        reviewerEmail?: string | null
        expiresInDays?: number
      }
    ) => Effect.Effect<ContentReviewTokenRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort | ContentReviewTokenStorePort>
    listReviewTokens: (
      principal: { userId: string },
      teamId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<ContentReviewTokenRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort | ContentReviewTokenStorePort>
    revokeReviewToken: (
      principal: { userId: string },
      teamId: string,
      tokenId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort | ContentReviewTokenStorePort>
    validateReviewToken: (
      token: string
    ) => Effect.Effect<{
      valid: boolean
      token?: ContentReviewTokenRecord
      teamId?: string
      permissions?: string[]
    }, CoreError, ContentReviewTokenStorePort>
  }
>() {}

const requireOrgMembership = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const orgMembershipPort = yield* TeamOrganizationMembershipPort
    const isMember = yield* orgMembershipPort.isMember(organizationId, userId).pipe(
      Effect.mapError((cause) => unauthorized('Failed to verify organization membership', cause))
    )
    if (!isMember) {
      return yield* Effect.fail(forbidden('Not allowed to access this organization'))
    }
    const disabledAt = yield* orgMembershipPort.getOrgMemberDisabledAt(organizationId, userId).pipe(
      Effect.mapError((cause) => unauthorized('Failed to check membership disabled status', cause))
    )
    if (disabledAt !== null) {
      return yield* Effect.fail(forbidden('Your organization membership has been disabled'))
    }
  })

const requireOrgAdmin = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const orgMembershipPort = yield* TeamOrganizationMembershipPort
    const role = yield* orgMembershipPort.getMemberRole(organizationId, userId).pipe(
      Effect.mapError((cause) => unauthorized('Failed to verify organization role', cause))
    )
    if (role !== 'admin') {
      return yield* Effect.fail(forbidden('Only admins can manage team members'))
    }
  })

const requireOrgAdminOrTeamMembership = (organizationId: string, teamId: string, userId: string) =>
  Effect.gen(function* () {
    yield* requireOrgMembership(organizationId, userId)

    const orgMembershipPort = yield* TeamOrganizationMembershipPort
    const role = yield* orgMembershipPort.getMemberRole(organizationId, userId).pipe(
      Effect.mapError((cause) => unauthorized('Failed to verify organization role', cause))
    )

    if (role === 'admin') {
      return
    }

    const teamStore = yield* TeamStorePort
    const teamMember = yield* teamStore.getMemberByTeamAndUser(teamId, userId).pipe(
      Effect.mapError((cause) => unauthorized('Failed to resolve team membership', cause)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(forbidden('You are not a member of this team')),
        onSome: Effect.succeed
      }))
    )

    if (teamMember.disabledAt !== null) {
      return yield* Effect.fail(forbidden('Your team membership has been disabled'))
    }
  })

export const TeamServiceLive = Layer.effect(
  TeamService,
  Effect.succeed({
    listForOrganization: (principal, organizationId, params) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        yield* requireOrgMembership(organizationId, principal.userId)

        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const role = yield* orgMembershipPort.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError((cause) => unauthorized('Failed to verify organization role', cause))
        )
        const page = yield* (role === 'admin'
          ? teamStore.list(organizationId, params)
          : teamStore.listForMember(organizationId, principal.userId, params)
        ).pipe(
          Effect.mapError((cause) => badRequest('Failed to list teams', cause))
        )

        return page
      }),

    getById: (principal, id) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(id).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgAdminOrTeamMembership(team.organizationId, id, principal.userId)

        return team
      }),

    create: (principal, input) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        if (!isValidTeamName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid team payload'))
        }

        if (!isValidBrandSettings(input.brandSettings)) {
          return yield* Effect.fail(badRequest('Invalid brand settings'))
        }

        const name = normalizeTeamName(input.name)
        yield* requireOrgMembership(input.organizationId, principal.userId)

        const created = yield* teamStore.create({
          organizationId: input.organizationId,
          name,
          website: input.website ?? null,
          brandSettings: input.brandSettings
        }).pipe(
          Effect.mapError((cause) => badRequest('Failed to create team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Team creation failed')),
            onSome: Effect.succeed
          }))
        )

        // Auto-add the creator as an admin team member so they can manage the team.
        // The auto-join trigger may have already added them as 'member' — the role
        // parameter triggers onConflictDoUpdate to promote to admin.
        yield* teamStore.addMember({ teamId: created.id, userId: principal.userId, role: 'admin' }).pipe(
          Effect.mapError((cause) => badRequest('Failed to add creator as team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Failed to add creator as team member')),
            onSome: Effect.succeed
          }))
        )

        return created
      }),

    update: (principal, id, input) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const existing = yield* teamStore.getById(id).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(existing.organizationId, principal.userId)
        yield* requireOrgAdmin(existing.organizationId, principal.userId)

        if (input.name === undefined && input.website === undefined && input.brandSettings === undefined) {
          return yield* Effect.fail(badRequest('Team update payload is empty'))
        }

        if (input.name !== undefined && !isValidTeamName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid team update payload'))
        }

        if (input.brandSettings !== undefined && input.brandSettings !== null) {
          if (!isValidBrandSettings(input.brandSettings)) {
            return yield* Effect.fail(badRequest('Invalid brand settings'))
          }
        }

        const patch: { id: string; name?: string; website?: string | null; brandSettings?: typeof input.brandSettings } = { id }

        if (input.name !== undefined) {
          patch.name = normalizeTeamName(input.name)
        }

        if (input.website !== undefined) {
          patch.website = input.website
        }

        if (input.brandSettings !== undefined) {
          patch.brandSettings = input.brandSettings
        }

        const updated = yield* teamStore.update(patch).pipe(
          Effect.mapError((cause) => badRequest('Failed to update team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        return updated
      }),

    remove: (principal, id) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const existing = yield* teamStore.getById(id).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(existing.organizationId, principal.userId)
        yield* requireOrgAdmin(existing.organizationId, principal.userId)

        return yield* teamStore.removeWithEvent({
          id,
          event: {
            eventType: 'team.deleted',
            aggregateType: 'team',
            payload: {
              teamId: id,
              teamName: existing.name,
              organizationId: existing.organizationId,
              deletedByUserId: principal.userId
            }
          }
        }).pipe(
          Effect.mapError((cause) => badRequest('Failed to delete team', cause))
        )
      }),

    addMember: (principal, teamId, userId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        const orgMembershipPort = yield* TeamOrganizationMembershipPort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        // Verify target user is a member of the same organization
        const targetIsMember = yield* orgMembershipPort.isMember(team.organizationId, userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to verify user membership', cause))
        )
        if (!targetIsMember) {
          return yield* Effect.fail(notFound('User is not a member of this organization'))
        }

        const added = yield* teamStore.addMember({ teamId, userId }).pipe(
          Effect.mapError((cause) => badRequest('Failed to add team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Failed to add team member')),
            onSome: Effect.succeed
          }))
        )

        return added
      }),

    removeMember: (principal, teamId, userId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        return yield* teamStore.removeMember(teamId, userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to remove team member', cause))
        )
      }),

    listMembers: (principal, teamId, params) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgAdminOrTeamMembership(team.organizationId, teamId, principal.userId)

        return yield* teamStore.listMembers(teamId, params).pipe(
          Effect.mapError((cause) => badRequest('Failed to list team members', cause))
        )
      }),

    addMemberById: (principal, teamId, userId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        const orgMembershipPort = yield* TeamOrganizationMembershipPort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        // Verify target user is a member of the same organization
        const targetIsMember = yield* orgMembershipPort.isMember(team.organizationId, userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to verify user membership', cause))
        )
        if (!targetIsMember) {
          return yield* Effect.fail(notFound('User is not a member of this organization'))
        }

        // Check if user is already a member of the team
        const existingOpt = yield* teamStore.getMemberByTeamAndUser(teamId, userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to check existing team member', cause))
        )

        if (Option.isSome(existingOpt)) {
          return yield* Effect.fail(conflict('User is already a member of this team'))
        }

        const added = yield* teamStore.addMember({ teamId, userId }).pipe(
          Effect.mapError((cause) => badRequest('Failed to add team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Failed to add team member')),
            onSome: Effect.succeed
          }))
        )

        return added
      }),

    getMemberById: (principal, teamId, memberId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)

        const member = yield* teamStore.getMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        if (member.teamId !== teamId) {
          return yield* Effect.fail(notFound('Team member not found'))
        }

        return member
      }),

    updateMemberRole: (principal, teamId, memberId, roleId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        const existing = yield* teamStore.getMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        if (existing.teamId !== teamId) {
          return yield* Effect.fail(notFound('Team member not found'))
        }

        const updated = yield* teamStore.updateMemberRole(memberId, roleId).pipe(
          Effect.mapError((cause) => badRequest('Failed to update team member role', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        return updated
      }),

    disableTeamMember: (principal, teamId, memberId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        const existing = yield* teamStore.getMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        if (existing.teamId !== teamId) {
          return yield* Effect.fail(notFound('Team member not found'))
        }

        const disabled = yield* teamStore.disableMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to disable team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        return disabled
      }),

    enableTeamMember: (principal, teamId, memberId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        const existing = yield* teamStore.getMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        if (existing.teamId !== teamId) {
          return yield* Effect.fail(notFound('Team member not found'))
        }

        const enabled = yield* teamStore.enableMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to enable team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        return enabled
      }),

    removeTeamMember: (principal, teamId, memberId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        const existing = yield* teamStore.getMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team member', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team member not found')),
            onSome: Effect.succeed
          }))
        )

        if (existing.teamId !== teamId) {
          return yield* Effect.fail(notFound('Team member not found'))
        }

        yield* teamStore.removeMemberById(memberId).pipe(
          Effect.mapError((cause) => badRequest('Failed to remove team member', cause))
        )

        return { deleted: true as const }
      }),

    createReviewToken: (principal, teamId, input) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        const tokenStore = yield* ContentReviewTokenStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        const MAX_REVIEW_TOKEN_EXPIRY_DAYS = 365
        const clampedExpiry = Math.min(input.expiresInDays ?? 30, MAX_REVIEW_TOKEN_EXPIRY_DAYS)
        const expiresAt = new Date(Date.now() + clampedExpiry * 24 * 60 * 60 * 1000)

        const created = yield* tokenStore.create({
          teamId,
          expiresAt,
          permissions: input.permissions,
          reviewerName: input.reviewerName ?? null,
          reviewerEmail: input.reviewerEmail ?? null,
          createdBy: principal.userId
        }).pipe(
          Effect.mapError((cause) => badRequest('Failed to create review token', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Review token creation failed')),
            onSome: Effect.succeed
          }))
        )

        return created
      }),

    listReviewTokens: (principal, teamId, params) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        const tokenStore = yield* ContentReviewTokenStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)

        return yield* tokenStore.list(teamId, params).pipe(
          Effect.mapError((cause) => badRequest('Failed to list review tokens', cause))
        )
      }),

    revokeReviewToken: (principal, teamId, tokenId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        const tokenStore = yield* ContentReviewTokenStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Team not found')),
            onSome: Effect.succeed
          }))
        )

        yield* requireOrgMembership(team.organizationId, principal.userId)
        yield* requireOrgAdmin(team.organizationId, principal.userId)

        const existing = yield* tokenStore.getById(tokenId).pipe(
          Effect.mapError((cause) => badRequest('Failed to fetch review token', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Review token not found')),
            onSome: Effect.succeed
          }))
        )

        if (existing.teamId !== teamId) {
          return yield* Effect.fail(notFound('Review token not found'))
        }

        yield* tokenStore.revoke(tokenId).pipe(
          Effect.mapError((cause) => badRequest('Failed to revoke review token', cause))
        )

        return { deleted: true as const }
      }),

    validateReviewToken: (token) =>
      Effect.gen(function* () {
        const tokenStore = yield* ContentReviewTokenStorePort

        const foundOpt = yield* tokenStore.findByToken(token).pipe(
          Effect.mapError((cause) => badRequest('Failed to validate review token', cause))
        )

        if (Option.isNone(foundOpt)) {
          return { valid: false }
        }

        const found = foundOpt.value

        if (found.revokedAt) {
          return { valid: false }
        }

        if (found.expiresAt < new Date()) {
          return { valid: false }
        }

        yield* tokenStore.touchLastAccessed(found.id).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        return {
          valid: true,
          token: found,
          teamId: found.teamId,
          permissions: [...found.permissions]
        }
      })
  })
)
