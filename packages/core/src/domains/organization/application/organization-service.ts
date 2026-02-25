import { Context, Effect, Layer } from 'effect'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import {
  canCreateInvitation,
  canDeleteOrganization,
  canManageInvitation,
  canManageOrganization,
  isValidInvitationEmail,
  isValidInvitationRoleUpdate,
  isValidInvitationStatusUpdate,
  isValidOrganizationName,
  normalizeInvitationEmail,
  normalizeOrganizationName,
  toInvitation,
  toOrganization,
  type CreateInvitationCommand,
  type CreateOrganizationCommand,
  type Invitation,
  type OrgMemberRole,
  type UpdateInvitationCommand,
  type UpdateOrganizationCommand,
  type Organization
} from '../domain/organization-domain.js'
import {
  InvitationEmailPort,
  OrganizationInvitationStorePort,
  OrganizationStorePort,
  OrganizationUsersPort
} from '../ports/organization-ports.js'

const hasInvitationReadAccess = (
  principalUserId: string,
  inviteeUserId: string | null,
  organizationRole: OrgMemberRole | null
): boolean => {
  if (inviteeUserId === principalUserId) {
    return true
  }

  return organizationRole === 'owner' || organizationRole === 'admin'
}

export class OrganizationService extends Context.Tag('OrganizationService')<
  OrganizationService,
  {
    listForUser: (
      userId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<Organization>, CoreError, OrganizationStorePort>
    getById: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<Organization, CoreError, OrganizationStorePort>
    getManyByIds: (
      principal: { userId: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<Organization>, CoreError, OrganizationStorePort>
    createForUser: (userId: string, input: CreateOrganizationCommand) => Effect.Effect<Organization, CoreError, OrganizationStorePort>
    updateById: (
      principal: { userId: string },
      organizationId: string,
      input: UpdateOrganizationCommand
    ) => Effect.Effect<Organization, CoreError, OrganizationStorePort>
    removeById: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, OrganizationStorePort>
    listInvitationsForUser: (
      userId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<Invitation>, CoreError, OrganizationInvitationStorePort>
    getInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string
    ) => Effect.Effect<Invitation, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    getManyInvitationsByIds: (
      principal: { userId: string; email: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<Invitation>, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    updateInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string,
      input: UpdateInvitationCommand
    ) => Effect.Effect<Invitation, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    removeInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    createInvitation: (
      principal: { userId: string; email: string },
      input: CreateInvitationCommand
    ) => Effect.Effect<
      Invitation,
      CoreError,
      OrganizationStorePort | OrganizationInvitationStorePort | OrganizationUsersPort | InvitationEmailPort
    >
    acceptInvitation: (
      principal: { userId: string; email: string },
      token: string
    ) => Effect.Effect<{ accepted: true }, CoreError, OrganizationInvitationStorePort>
  }
>() {}

export const OrganizationServiceLive = Layer.effect(
  OrganizationService,
  Effect.succeed({
    listForUser: (userId: string, params: ListParams) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort
        const page = yield* organizationStore.listForUser(userId, params).pipe(
          Effect.mapError(() => badRequest('Failed to list organizations'))
        )

        return {
          data: page.data.map(toOrganization),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      }),

    getById: (principal, organizationId: string) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        const organization = yield* organizationStore.getById(organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch organization'))
        )

        if (!organization) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const isMember = yield* organizationStore.isMember(organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this organization'))
        }

        return toOrganization(organization)
      }),

    getManyByIds: (principal, ids) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* organizationStore.getManyByIdsForUser(principal.userId, ids).pipe(
          Effect.mapError(() => badRequest('Failed to fetch organizations'))
        )

        const byId = new Map(rows.map((row) => [row.id, row] as const))
        return ids.flatMap((id) => {
          const row = byId.get(id)
          return row ? [toOrganization(row)] : []
        })
      }),

    createForUser: (userId: string, input) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        if (!isValidOrganizationName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid organization payload'))
        }

        const name = normalizeOrganizationName(input.name)

        const created = yield* organizationStore.create({ name, ownerUserId: userId }).pipe(
          Effect.mapError(() => badRequest('Failed to create organization'))
        )

        if (!created) {
          return yield* Effect.fail(badRequest('Organization creation failed'))
        }

        return toOrganization(created)
      }),

    updateById: (principal, organizationId: string, input) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        const existing = yield* organizationStore.getById(organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch organization'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const role = yield* organizationStore.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to update organization'))
        )

        if (!role || !canManageOrganization(role)) {
          return yield* Effect.fail(unauthorized('Only admins and owners can update organizations'))
        }

        if (input.name === undefined && input.onboardingData === undefined) {
          return yield* Effect.fail(badRequest('Organization update payload is empty'))
        }

        if (input.name !== undefined && !isValidOrganizationName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid organization update payload'))
        }

        const updated = yield* organizationStore.update({
          id: organizationId,
          name: input.name === undefined ? undefined : normalizeOrganizationName(input.name),
          onboardingData: input.onboardingData
        }).pipe(Effect.mapError(() => badRequest('Failed to update organization')))

        if (!updated) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        return toOrganization(updated)
      }),

    removeById: (principal, organizationId: string) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        const existing = yield* organizationStore.getById(organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch organization'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Organization not found'))
        }

        const role = yield* organizationStore.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to delete organization'))
        )

        if (!role || !canDeleteOrganization(role)) {
          return yield* Effect.fail(unauthorized('Only organization owners can delete organizations'))
        }

        return yield* organizationStore.remove(organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to delete organization'))
        )
      }),

    listInvitationsForUser: (userId: string, params: ListParams) =>
      Effect.gen(function* () {
        const invitationStore = yield* OrganizationInvitationStorePort
        const page = yield* invitationStore.listForInviteeUserId(userId, params).pipe(
          Effect.mapError(() => badRequest('Failed to list invitations'))
        )

        return {
          data: page.data.map(toInvitation),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      }),

    getInvitationById: (principal, invitationId: string) =>
      Effect.gen(function* () {
        const invitationStore = yield* OrganizationInvitationStorePort
        const organizationStore = yield* OrganizationStorePort

        const invitation = yield* invitationStore.getById(invitationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitation'))
        )

        if (!invitation) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        const role = yield* organizationStore.getMemberRole(invitation.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify invitation access'))
        )

        if (!hasInvitationReadAccess(principal.userId, invitation.inviteeUserId, role)) {
          return yield* Effect.fail(unauthorized('Not allowed to access this invitation'))
        }

        return toInvitation(invitation)
      }),

    getManyInvitationsByIds: (principal, ids) =>
      Effect.gen(function* () {
        const invitationStore = yield* OrganizationInvitationStorePort
        const organizationStore = yield* OrganizationStorePort

        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* invitationStore.getManyByIds(ids).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitations'))
        )

        const uniqueOrganizationIds = [...new Set(rows.map((row) => row.organizationId))]
        const organizationRoles = yield* organizationStore
          .getMemberRolesForUser(principal.userId, uniqueOrganizationIds)
          .pipe(Effect.mapError(() => unauthorized('Failed to verify invitation access')))

        const accessibleRows = rows.filter((invitation) =>
          hasInvitationReadAccess(
            principal.userId,
            invitation.inviteeUserId,
            organizationRoles.get(invitation.organizationId) ?? null
          )
        )

        const byId = new Map(accessibleRows.map((row) => [row.id, row] as const))
        return ids.flatMap((id) => {
          const row = byId.get(id)
          return row ? [toInvitation(row)] : []
        })
      }),

    updateInvitationById: (principal, invitationId: string, input) =>
      Effect.gen(function* () {
        const invitationStore = yield* OrganizationInvitationStorePort
        const organizationStore = yield* OrganizationStorePort

        const existing = yield* invitationStore.getById(invitationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitation'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        const role = yield* organizationStore.getMemberRole(existing.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to update invitation'))
        )

        if (!role || !canManageInvitation(role)) {
          return yield* Effect.fail(unauthorized('Only admins and owners can update invitations'))
        }

        if (!isValidInvitationRoleUpdate(input.role) || !isValidInvitationStatusUpdate(input.status)) {
          return yield* Effect.fail(badRequest('Invalid invitation update payload'))
        }

        if (input.role === undefined && input.status === undefined) {
          return yield* Effect.fail(badRequest('Invitation update payload is empty'))
        }

        if (input.status === 'accepted') {
          return yield* Effect.fail(badRequest('Invitation status cannot be set to accepted manually'))
        }

        const updated = yield* invitationStore.updateById({
          id: invitationId,
          role: input.role,
          status: input.status
        }).pipe(Effect.mapError(() => badRequest('Failed to update invitation')))

        if (!updated) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        return toInvitation(updated)
      }),

    removeInvitationById: (principal, invitationId: string) =>
      Effect.gen(function* () {
        const invitationStore = yield* OrganizationInvitationStorePort
        const organizationStore = yield* OrganizationStorePort

        const existing = yield* invitationStore.getById(invitationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitation'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        const role = yield* organizationStore.getMemberRole(existing.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to revoke invitation'))
        )

        if (!role || !canManageInvitation(role)) {
          return yield* Effect.fail(unauthorized('Only admins and owners can revoke invitations'))
        }

        const revoked = yield* invitationStore.updateById({
          id: invitationId,
          status: 'revoked'
        }).pipe(Effect.mapError(() => badRequest('Failed to revoke invitation')))

        if (!revoked) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        return { deleted: true as const }
      }),

    createInvitation: (principal, input) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort
        const invitationStore = yield* OrganizationInvitationStorePort
        const usersPort = yield* OrganizationUsersPort
        const emailPort = yield* InvitationEmailPort

        if (!isValidInvitationEmail(input.email)) {
          return yield* Effect.fail(badRequest('Invalid invitation payload'))
        }

        const email = normalizeInvitationEmail(input.email)

        const inviterRole = yield* organizationStore.getMemberRole(input.organizationId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to invite'))
        )

        if (!inviterRole) {
          return yield* Effect.fail(unauthorized('Not allowed to invite'))
        }

        if (!canCreateInvitation(inviterRole)) {
          return yield* Effect.fail(unauthorized('Only admins and owners can create invitations'))
        }

        const existingUser = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError(() => badRequest('Failed to look up invited user'))
        )

        if (!existingUser) {
          return yield* Effect.fail(badRequest('Invited user must already have an account'))
        }

        const alreadyMember = yield* organizationStore.isMember(input.organizationId, existingUser.id).pipe(
          Effect.mapError(() => badRequest('Failed to validate existing membership'))
        )

        if (alreadyMember) {
          return yield* Effect.fail(conflict('User is already an organization member'))
        }

        const created = yield* invitationStore.create({
          organizationId: input.organizationId,
          inviteeUserId: existingUser.id,
          email,
          role: input.role,
          invitedByUserId: principal.userId
        }).pipe(Effect.mapError(() => badRequest('Failed to create invitation')))

        if (!created) {
          return yield* Effect.fail(badRequest('Invitation creation failed'))
        }

        const organization = yield* organizationStore.getById(input.organizationId).pipe(
          Effect.mapError(() => badRequest('Failed to look up organization for email'))
        )

        const inviter = yield* usersPort.findById(principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to look up inviter for email'))
        )

        yield* emailPort.sendInvitationEmail({
          recipientEmail: email,
          recipientName: existingUser.name,
          organizationName: organization?.name ?? 'your organization',
          inviterName: inviter?.name ?? 'A teammate',
          role: input.role,
          token: created.token
        }).pipe(
          Effect.catchAll(() => Effect.void)
        )

        return toInvitation(created)
      }),

    acceptInvitation: (principal, token: string) =>
      Effect.gen(function* () {
        const invitationStore = yield* OrganizationInvitationStorePort

        if (!token) {
          return yield* Effect.fail(badRequest('Missing invitation token'))
        }

        const accepted = yield* invitationStore.acceptByToken(token, principal.userId).pipe(
          Effect.mapError(() => badRequest('Failed to accept invitation'))
        )

        if (!accepted) {
          return yield* Effect.fail(notFound('Invitation not found or expired'))
        }

        return { accepted: true as const }
      })
  })
)
