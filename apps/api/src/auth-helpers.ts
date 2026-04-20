import { TeamAuthMiddleware, OrgAuthMiddleware } from '@tx-agent-kit/core'
import type { PermissionAction } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { Forbidden, mapCoreError } from './api.js'
import { requireAuth } from './utils.js'

export const requireTeamAuth = (teamId: string) =>
  Effect.gen(function* () {
    const principal = yield* requireAuth
    const teamAuth = yield* TeamAuthMiddleware
    const result = yield* teamAuth.resolveTeamMember(teamId, principal.userId)
      .pipe(Effect.mapError(mapCoreError))
    return { principal, ...result }
  })

export const requireTeamPermission = (teamId: string, permission: PermissionAction) =>
  Effect.gen(function* () {
    const principal = yield* requireAuth
    const teamAuth = yield* TeamAuthMiddleware
    const result = yield* teamAuth.resolveTeamMember(teamId, principal.userId)
      .pipe(Effect.mapError(mapCoreError))
    if (!result.permissions.includes(permission)) {
      return yield* Effect.fail(new Forbidden({ message: `Missing permission: ${permission}` }))
    }
    return { principal, ...result }
  })

export const requireOrgAuth = (organizationId: string) =>
  Effect.gen(function* () {
    const principal = yield* requireAuth
    const orgAuth = yield* OrgAuthMiddleware
    yield* orgAuth.resolveOrgMember(organizationId, principal.userId)
      .pipe(Effect.mapError(mapCoreError))
    return principal
  })
