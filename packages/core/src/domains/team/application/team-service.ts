import { Context, Effect, Layer } from 'effect'
import { badRequest, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import {
  isValidTeamName,
  normalizeTeamName,
  toTeam,
  type CreateTeamCommand,
  type Team,
  type TeamMemberRecord,
  type UpdateTeamCommand
} from '../domain/team-domain.js'
import { TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'

export class TeamService extends Context.Tag('TeamService')<
  TeamService,
  {
    listForOrganization: (
      principal: { userId: string },
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<Team>, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    getById: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<Team, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    create: (
      principal: { userId: string },
      input: CreateTeamCommand
    ) => Effect.Effect<Team, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    update: (
      principal: { userId: string },
      id: string,
      input: UpdateTeamCommand
    ) => Effect.Effect<Team, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
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
      teamId: string
    ) => Effect.Effect<ReadonlyArray<TeamMemberRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
  }
>() {}

export const TeamServiceLive = Layer.effect(
  TeamService,
  Effect.succeed({
    listForOrganization: (principal, organizationId, params) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const isMember = yield* orgMembershipPort.isMember(organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this organization'))
        }

        const page = yield* teamStore.list(organizationId, params).pipe(
          Effect.mapError(() => badRequest('Failed to list teams'))
        )

        return {
          data: page.data.map(toTeam),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      }),

    getById: (principal, id) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const row = yield* teamStore.getById(id).pipe(
          Effect.mapError(() => badRequest('Failed to fetch team'))
        )

        if (!row) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        const isMember = yield* orgMembershipPort.isMember(row.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this organization'))
        }

        return toTeam(row)
      }),

    create: (principal, input) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        if (!isValidTeamName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid team payload'))
        }

        const name = normalizeTeamName(input.name)

        const isMember = yield* orgMembershipPort.isMember(input.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to create teams in this organization'))
        }

        const created = yield* teamStore.create({
          organizationId: input.organizationId,
          name
        }).pipe(Effect.mapError(() => badRequest('Failed to create team')))

        if (!created) {
          return yield* Effect.fail(badRequest('Team creation failed'))
        }

        return toTeam(created)
      }),

    update: (principal, id, input) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const existing = yield* teamStore.getById(id).pipe(
          Effect.mapError(() => badRequest('Failed to fetch team'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        const isMember = yield* orgMembershipPort.isMember(existing.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to update this team'))
        }

        if (input.name === undefined) {
          return yield* Effect.fail(badRequest('Team update payload is empty'))
        }

        if (!isValidTeamName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid team update payload'))
        }

        const updated = yield* teamStore.update({
          id,
          name: normalizeTeamName(input.name)
        }).pipe(Effect.mapError(() => badRequest('Failed to update team')))

        if (!updated) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        return toTeam(updated)
      }),

    remove: (principal, id) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const existing = yield* teamStore.getById(id).pipe(
          Effect.mapError(() => badRequest('Failed to fetch team'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        const isMember = yield* orgMembershipPort.isMember(existing.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to delete this team'))
        }

        return yield* teamStore.remove(id).pipe(
          Effect.mapError(() => badRequest('Failed to delete team'))
        )
      }),

    addMember: (principal, teamId, userId) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch team'))
        )

        if (!team) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        const isMember = yield* orgMembershipPort.isMember(team.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to manage members of this team'))
        }

        const added = yield* teamStore.addMember({ teamId, userId }).pipe(
          Effect.mapError(() => badRequest('Failed to add team member'))
        )

        if (!added) {
          return yield* Effect.fail(badRequest('Failed to add team member'))
        }

        return added
      }),

    removeMember: (principal, teamId, userId) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch team'))
        )

        if (!team) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        const isMember = yield* orgMembershipPort.isMember(team.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to manage members of this team'))
        }

        return yield* teamStore.removeMember(teamId, userId).pipe(
          Effect.mapError(() => badRequest('Failed to remove team member'))
        )
      }),

    listMembers: (principal, teamId) =>
      Effect.gen(function* () {
        const orgMembershipPort = yield* TeamOrganizationMembershipPort
        const teamStore = yield* TeamStorePort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch team'))
        )

        if (!team) {
          return yield* Effect.fail(notFound('Team not found'))
        }

        const isMember = yield* orgMembershipPort.isMember(team.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this team'))
        }

        return yield* teamStore.listMembers(teamId).pipe(
          Effect.mapError(() => badRequest('Failed to list team members'))
        )
      })
  })
)
