import { HttpApiBuilder } from '@effect/platform'
import { OrganizationService, OrganizationMemberService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { toApiOrganization, toApiInvitation, toApiInvitationSummary, toApiOrgMember } from '../mappers/organization-mapper.js'
import { requireAuth } from '../utils.js'
import { parseListQuery } from './list-query.js'

export const OrganizationsRouteKind = 'crud' as const

export const OrganizationsLive = HttpApiBuilder.group(TxAgentApi, 'organizations', (handlers) =>
  handlers
    .handle('listOrganizations', ({ urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'name'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listForUser(principal.userId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiOrganization),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getOrganization', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const organization = yield* service.getById(principal, path.organizationId).pipe(Effect.mapError(mapCoreError))
        return toApiOrganization(organization)
      })
    )
    .handle('getManyOrganizations', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const organizations = yield* service.getManyByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))

        return {
          data: organizations.map(toApiOrganization)
        }
      })
    )
    .handle('createOrganization', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const organization = yield* service.createForUser(principal.userId, payload, { email: principal.email }).pipe(Effect.mapError(mapCoreError))
        return toApiOrganization(organization)
      })
    )
    .handle('updateOrganization', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const organization = yield* service.updateById(principal, path.organizationId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiOrganization(organization)
      })
    )
    .handle('removeOrganization', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        return yield* service.removeById(principal, path.organizationId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('listInvitations', ({ urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'expiresAt'],
          allowedFilterKeys: ['status', 'role']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listInvitationsForUser(principal, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiInvitation),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getInvitation', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const invitation = yield* service.getInvitationById(principal, path.invitationId).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('getManyInvitations', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const invitations = yield* service.getManyInvitationsByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))

        return {
          data: invitations.map(toApiInvitationSummary)
        }
      })
    )
    .handle('createInvitation', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const invitation = yield* service.createInvitation(principal, payload).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('updateInvitation', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        const invitation = yield* service.updateInvitationById(principal, path.invitationId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiInvitationSummary(invitation)
      })
    )
    .handle('removeInvitation', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        return yield* service.removeInvitationById(principal, path.invitationId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('acceptInvitation', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService
        return yield* service.acceptInvitation(principal, path.token).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('addOrgMember', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const memberService = yield* OrganizationMemberService
        const role = payload.role ?? 'member'
        const added = yield* memberService.addMember(principal, path.organizationId, payload.userId, role).pipe(Effect.mapError(mapCoreError))
        return toApiOrgMember(added)
      })
    )
    .handle('listOrgMembers', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listOrgMembers(principal, path.organizationId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiOrgMember),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('listOrgInvitations', ({ path, urlParams }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* OrganizationService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'expiresAt'],
          allowedFilterKeys: ['status', 'role']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listOrgInvitations(principal, path.organizationId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiInvitationSummary),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('updateMemberRole', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const memberService = yield* OrganizationMemberService
        const updated = yield* memberService.updateMemberRole(principal, path.organizationId, path.memberId, payload.role).pipe(Effect.mapError(mapCoreError))
        return toApiOrgMember(updated)
      })
    )
    .handle('disableMember', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const memberService = yield* OrganizationMemberService
        const disabled = yield* memberService.disableMember(principal, path.organizationId, path.memberId).pipe(Effect.mapError(mapCoreError))
        return toApiOrgMember(disabled)
      })
    )
    .handle('enableMember', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const memberService = yield* OrganizationMemberService
        const enabled = yield* memberService.enableMember(principal, path.organizationId, path.memberId).pipe(Effect.mapError(mapCoreError))
        return toApiOrgMember(enabled)
      })
    )
    .handle('removeMember', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const memberService = yield* OrganizationMemberService
        return yield* memberService.removeMember(principal, path.organizationId, path.memberId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('transferOwnership', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const memberService = yield* OrganizationMemberService
        return yield* memberService.transferOwnership(principal, path.organizationId, principal.userId, payload.newOwnerUserId).pipe(Effect.mapError(mapCoreError))
      })
    )
)
