import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, conflict, internalError, notFound, unauthorized, type CoreError } from '../../../errors.js'
import { requireOwnership, requireRole, withInternalError } from '../../../effect-utils.js'
import {
  canManageMembers,
  type OrgMemberRecord,
  type OrgMemberRole
} from '../domain/organization-domain.js'
import { OrganizationMemberStorePort, OrganizationStorePort, OrganizationUsersPort } from '../ports/organization-ports.js'

export class OrganizationMemberService extends Context.Tag('OrganizationMemberService')<
  OrganizationMemberService,
  {
    addMember: (
      principal: { userId: string },
      orgId: string,
      userId: string,
      role: OrgMemberRole
    ) => Effect.Effect<OrgMemberRecord, CoreError, OrganizationMemberStorePort | OrganizationStorePort | OrganizationUsersPort>
    updateMemberRole: (
      principal: { userId: string },
      orgId: string,
      memberId: string,
      newRole: OrgMemberRole
    ) => Effect.Effect<OrgMemberRecord, CoreError, OrganizationMemberStorePort | OrganizationStorePort>
    disableMember: (
      principal: { userId: string },
      orgId: string,
      memberId: string
    ) => Effect.Effect<OrgMemberRecord, CoreError, OrganizationMemberStorePort | OrganizationStorePort>
    enableMember: (
      principal: { userId: string },
      orgId: string,
      memberId: string
    ) => Effect.Effect<OrgMemberRecord, CoreError, OrganizationMemberStorePort | OrganizationStorePort>
    removeMember: (
      principal: { userId: string },
      orgId: string,
      memberId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, OrganizationMemberStorePort | OrganizationStorePort>
    transferOwnership: (
      principal: { userId: string },
      orgId: string,
      fromUserId: string,
      toUserId: string
    ) => Effect.Effect<{ transferred: true }, CoreError, OrganizationMemberStorePort | OrganizationStorePort>
  }
>() {}

export const OrganizationMemberServiceLive = Layer.effect(
  OrganizationMemberService,
  Effect.succeed({
    addMember: (principal, orgId, userId, role) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort
        const usersPort = yield* OrganizationUsersPort

        const callerRole = yield* withInternalError(orgStore.getMemberRole(orgId, principal.userId), 'Failed to verify membership')
        yield* requireRole(Option.getOrNull(callerRole), canManageMembers, 'Only admins and owners can manage members', { orgId, callerId: principal.userId })

        // Check user exists
        yield* withInternalError(usersPort.findById(userId), 'Failed to look up user').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('User not found')),
            onSome: Effect.succeed
          }))
        )

        // Check not already a member
        const existingMember = yield* withInternalError(memberStore.getMember(orgId, userId), 'Failed to check existing membership')
        if (Option.isSome(existingMember)) {
          return yield* Effect.fail(conflict('User is already a member of this organization'))
        }

        // Insert the member — catch unique-constraint violations from a race
        const member = yield* memberStore.addMember({ organizationId: orgId, userId, role }).pipe(
          Effect.mapError((cause) => {
            const msg = cause instanceof Error ? cause.message : String(cause)
            if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('UNIQUE_VIOLATION')) {
              return conflict('User is already a member of this organization', cause)
            }
            return internalError('Failed to add member', cause)
          })
        )

        return yield* Option.match(member, {
          onNone: () => Effect.fail(internalError('Failed to add member')),
          onSome: Effect.succeed
        })
      }),

    updateMemberRole: (principal, orgId, memberId, newRole) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort

        const callerRole = yield* withInternalError(orgStore.getMemberRole(orgId, principal.userId), 'Failed to verify membership')
        yield* requireRole(Option.getOrNull(callerRole), canManageMembers, 'Only admins and owners can manage members', { orgId, callerId: principal.userId })

        const target = yield* withInternalError(memberStore.getMemberById(memberId), 'Failed to fetch member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(target, orgId, 'organizationId', 'Member not found', { memberId, orgId })

        if (target.role === 'admin' && newRole !== 'admin') {
          const activeAdmins = yield* withInternalError(memberStore.countActiveAdmins(orgId), 'Failed to check admin count')
          if (activeAdmins <= 1) {
            return yield* Effect.fail(conflict('Cannot demote the last active admin'))
          }
        }

        return yield* withInternalError(memberStore.updateMemberRole(memberId, newRole), 'Failed to update member role').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
      }),

    disableMember: (principal, orgId, memberId) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort

        const callerRole = yield* withInternalError(orgStore.getMemberRole(orgId, principal.userId), 'Failed to verify membership')
        yield* requireRole(Option.getOrNull(callerRole), canManageMembers, 'Only admins and owners can manage members', { orgId, callerId: principal.userId })

        const target = yield* withInternalError(memberStore.getMemberById(memberId), 'Failed to fetch member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(target, orgId, 'organizationId', 'Member not found', { memberId, orgId })

        if (target.role === 'admin') {
          const activeAdmins = yield* withInternalError(memberStore.countActiveAdmins(orgId), 'Failed to check admin count')
          if (activeAdmins <= 1) {
            return yield* Effect.fail(conflict('Cannot disable the last active admin'))
          }
        }

        return yield* withInternalError(memberStore.disableMember(memberId), 'Failed to disable member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
      }),

    enableMember: (principal, orgId, memberId) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort

        const callerRole = yield* withInternalError(orgStore.getMemberRole(orgId, principal.userId), 'Failed to verify membership')
        yield* requireRole(Option.getOrNull(callerRole), canManageMembers, 'Only admins and owners can manage members', { orgId, callerId: principal.userId })

        const target = yield* withInternalError(memberStore.getMemberById(memberId), 'Failed to fetch member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(target, orgId, 'organizationId', 'Member not found', { memberId, orgId })

        return yield* withInternalError(memberStore.enableMember(memberId), 'Failed to enable member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
      }),

    removeMember: (principal, orgId, memberId) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort

        const callerRole = yield* withInternalError(orgStore.getMemberRole(orgId, principal.userId), 'Failed to verify membership')
        yield* requireRole(Option.getOrNull(callerRole), canManageMembers, 'Only admins and owners can manage members', { orgId, callerId: principal.userId })

        const target = yield* withInternalError(memberStore.getMemberById(memberId), 'Failed to fetch member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Member not found')),
            onSome: Effect.succeed
          }))
        )
        yield* requireOwnership(target, orgId, 'organizationId', 'Member not found', { memberId, orgId })

        if (target.role === 'admin') {
          const activeAdmins = yield* withInternalError(memberStore.countActiveAdmins(orgId), 'Failed to check admin count')
          if (activeAdmins <= 1) {
            return yield* Effect.fail(conflict('Cannot remove the last active admin'))
          }
        }

        if (target.userId === principal.userId) {
          return yield* Effect.fail(conflict('You cannot remove yourself from the organization. Transfer ownership or ask another admin to remove you.'))
        }

        return yield* withInternalError(memberStore.removeMember(memberId), 'Failed to remove member')
      }),

    transferOwnership: (principal, orgId, fromUserId, toUserId) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort

        // Ownership is determined by organizations.owner_user_id, not role
        const org = yield* withInternalError(orgStore.getById(orgId), 'Failed to fetch organization').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        if (org.ownerUserId !== principal.userId) {
          return yield* Effect.fail(unauthorized('Only the organization owner can transfer ownership'))
        }

        if (principal.userId !== fromUserId) {
          return yield* Effect.fail(unauthorized('You can only transfer ownership from yourself'))
        }

        if (fromUserId === toUserId) {
          return yield* Effect.fail(badRequest('Cannot transfer ownership to yourself'))
        }

        const targetMember = yield* withInternalError(memberStore.getMember(orgId, toUserId), 'Failed to fetch target member').pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Target user is not a member of this organization')),
            onSome: Effect.succeed
          }))
        )

        if (targetMember.role !== 'admin') {
          return yield* Effect.fail(badRequest('Ownership can only be transferred to an active admin'))
        }

        if (targetMember.disabledAt !== null) {
          return yield* Effect.fail(badRequest('Ownership can only be transferred to an active admin'))
        }

        return yield* withInternalError(
          memberStore.transferOwnership({ organizationId: orgId, fromUserId, toUserId }),
          'Failed to transfer ownership'
        )
      })
  })
)
