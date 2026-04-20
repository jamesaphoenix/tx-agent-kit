import { Context, Effect, Layer, Option } from 'effect'
import type { MemberRole, PermissionAction } from '@tx-agent-kit/contracts'
import { getPermissionsForTeamRole } from '@tx-agent-kit/contracts'
import { forbidden, unauthorized, type CoreError } from '../../../errors.js'
import type { TeamMemberRecord } from '../domain/team-domain.js'
import { TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'

export interface TeamAuthResult {
  readonly member: TeamMemberRecord
  readonly role: MemberRole
  readonly permissions: ReadonlyArray<PermissionAction>
}

export class TeamAuthMiddleware extends Context.Tag('TeamAuthMiddleware')<
  TeamAuthMiddleware,
  {
    resolveTeamMember: (
      teamId: string,
      userId: string
    ) => Effect.Effect<TeamAuthResult, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
  }
>() {}

export const TeamAuthMiddlewareLive = Layer.effect(
  TeamAuthMiddleware,
  Effect.succeed({
    resolveTeamMember: (teamId, userId) =>
      Effect.gen(function* () {
        const teamStore = yield* TeamStorePort
        const orgMembershipPort = yield* TeamOrganizationMembershipPort

        const team = yield* teamStore.getById(teamId).pipe(
          Effect.mapError((cause) => unauthorized('Failed to resolve team', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(forbidden('You are not a member of this team')),
            onSome: Effect.succeed
          }))
        )

        const isMember = yield* orgMembershipPort.isMember(team.organizationId, userId).pipe(
          Effect.mapError((cause) => unauthorized('Failed to verify organization membership', cause))
        )
        if (!isMember) {
          return yield* Effect.fail(forbidden('You are not a member of this organization'))
        }

        const orgDisabledAt = yield* orgMembershipPort.getOrgMemberDisabledAt(team.organizationId, userId).pipe(
          Effect.mapError((cause) => unauthorized('Failed to verify organization membership', cause))
        )

        if (orgDisabledAt !== null) {
          return yield* Effect.fail(forbidden('Your organization membership has been disabled'))
        }

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

        const role = teamMember.role
        const permissions = getPermissionsForTeamRole(role)
        return { member: teamMember, role, permissions }
      })
  })
)
