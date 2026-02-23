import { Context, Effect, Layer } from 'effect'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import {
  canCreateInvitation,
  canDeleteWorkspace,
  canManageInvitation,
  canManageWorkspace,
  isValidInvitationEmail,
  isValidInvitationRoleUpdate,
  isValidInvitationStatusUpdate,
  isValidWorkspaceName,
  normalizeInvitationEmail,
  normalizeWorkspaceName,
  toInvitation,
  toWorkspace,
  type CreateInvitationCommand,
  type CreateWorkspaceCommand,
  type Invitation,
  type WorkspaceMemberRole,
  type UpdateInvitationCommand,
  type UpdateWorkspaceCommand,
  type Workspace
} from '../domain/workspace-domain.js'
import {
  WorkspaceInvitationStorePort,
  WorkspaceStorePort,
  WorkspaceUsersPort
} from '../ports/workspace-ports.js'

const hasInvitationReadAccess = (
  principalUserId: string,
  inviteeUserId: string | null,
  workspaceRole: WorkspaceMemberRole | null
): boolean => {
  if (inviteeUserId === principalUserId) {
    return true
  }

  return workspaceRole === 'owner' || workspaceRole === 'admin'
}

export class WorkspaceService extends Context.Tag('WorkspaceService')<
  WorkspaceService,
  {
    listForUser: (
      userId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<Workspace>, CoreError, WorkspaceStorePort>
    getById: (
      principal: { userId: string },
      workspaceId: string
    ) => Effect.Effect<Workspace, CoreError, WorkspaceStorePort>
    getManyByIds: (
      principal: { userId: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<Workspace>, CoreError, WorkspaceStorePort>
    createForUser: (userId: string, input: CreateWorkspaceCommand) => Effect.Effect<Workspace, CoreError, WorkspaceStorePort>
    updateById: (
      principal: { userId: string },
      workspaceId: string,
      input: UpdateWorkspaceCommand
    ) => Effect.Effect<Workspace, CoreError, WorkspaceStorePort>
    removeById: (
      principal: { userId: string },
      workspaceId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, WorkspaceStorePort>
    listInvitationsForUser: (
      userId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<Invitation>, CoreError, WorkspaceInvitationStorePort>
    getInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string
    ) => Effect.Effect<Invitation, CoreError, WorkspaceStorePort | WorkspaceInvitationStorePort>
    getManyInvitationsByIds: (
      principal: { userId: string; email: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<Invitation>, CoreError, WorkspaceStorePort | WorkspaceInvitationStorePort>
    updateInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string,
      input: UpdateInvitationCommand
    ) => Effect.Effect<Invitation, CoreError, WorkspaceStorePort | WorkspaceInvitationStorePort>
    removeInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, WorkspaceStorePort | WorkspaceInvitationStorePort>
    createInvitation: (
      principal: { userId: string; email: string },
      input: CreateInvitationCommand
    ) => Effect.Effect<
      Invitation,
      CoreError,
      WorkspaceStorePort | WorkspaceInvitationStorePort | WorkspaceUsersPort
    >
    acceptInvitation: (
      principal: { userId: string; email: string },
      token: string
    ) => Effect.Effect<{ accepted: true }, CoreError, WorkspaceInvitationStorePort>
  }
>() {}

export const WorkspaceServiceLive = Layer.effect(
  WorkspaceService,
  Effect.succeed({
    listForUser: (userId: string, params: ListParams) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort
        const page = yield* workspaceStore.listForUser(userId, params).pipe(
          Effect.mapError(() => badRequest('Failed to list workspaces'))
        )

        return {
          data: page.data.map(toWorkspace),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      }),

    getById: (principal, workspaceId: string) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort

        const workspace = yield* workspaceStore.getById(workspaceId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch workspace'))
        )

        if (!workspace) {
          return yield* Effect.fail(notFound('Workspace not found'))
        }

        const isMember = yield* workspaceStore.isMember(workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify workspace membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this workspace'))
        }

        return toWorkspace(workspace)
      }),

    getManyByIds: (principal, ids) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort

        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* workspaceStore.getManyByIdsForUser(principal.userId, ids).pipe(
          Effect.mapError(() => badRequest('Failed to fetch workspaces'))
        )

        const byId = new Map(rows.map((row) => [row.id, row] as const))
        return ids.flatMap((id) => {
          const row = byId.get(id)
          return row ? [toWorkspace(row)] : []
        })
      }),

    createForUser: (userId: string, input) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort

        if (!isValidWorkspaceName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid workspace payload'))
        }

        const name = normalizeWorkspaceName(input.name)

        const created = yield* workspaceStore.create({ name, ownerUserId: userId }).pipe(
          Effect.mapError(() => badRequest('Failed to create workspace'))
        )

        if (!created) {
          return yield* Effect.fail(badRequest('Workspace creation failed'))
        }

        return toWorkspace(created)
      }),

    updateById: (principal, workspaceId: string, input) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort

        const existing = yield* workspaceStore.getById(workspaceId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch workspace'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Workspace not found'))
        }

        const role = yield* workspaceStore.getMemberRole(workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to update workspace'))
        )

        if (!role || !canManageWorkspace(role)) {
          return yield* Effect.fail(unauthorized('Only admins and owners can update workspaces'))
        }

        if (input.name === undefined) {
          return yield* Effect.fail(badRequest('Workspace update payload is empty'))
        }

        if (!isValidWorkspaceName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid workspace update payload'))
        }

        const updated = yield* workspaceStore.update({
          id: workspaceId,
          name: normalizeWorkspaceName(input.name)
        }).pipe(Effect.mapError(() => badRequest('Failed to update workspace')))

        if (!updated) {
          return yield* Effect.fail(notFound('Workspace not found'))
        }

        return toWorkspace(updated)
      }),

    removeById: (principal, workspaceId: string) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort

        const existing = yield* workspaceStore.getById(workspaceId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch workspace'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Workspace not found'))
        }

        const role = yield* workspaceStore.getMemberRole(workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to delete workspace'))
        )

        if (!role || !canDeleteWorkspace(role)) {
          return yield* Effect.fail(unauthorized('Only workspace owners can delete workspaces'))
        }

        return yield* workspaceStore.remove(workspaceId).pipe(
          Effect.mapError(() => badRequest('Failed to delete workspace'))
        )
      }),

    listInvitationsForUser: (userId: string, params: ListParams) =>
      Effect.gen(function* () {
        const invitationStore = yield* WorkspaceInvitationStorePort
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
        const invitationStore = yield* WorkspaceInvitationStorePort
        const workspaceStore = yield* WorkspaceStorePort

        const invitation = yield* invitationStore.getById(invitationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitation'))
        )

        if (!invitation) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        const role = yield* workspaceStore.getMemberRole(invitation.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Failed to verify invitation access'))
        )

        if (!hasInvitationReadAccess(principal.userId, invitation.inviteeUserId, role)) {
          return yield* Effect.fail(unauthorized('Not allowed to access this invitation'))
        }

        return toInvitation(invitation)
      }),

    getManyInvitationsByIds: (principal, ids) =>
      Effect.gen(function* () {
        const invitationStore = yield* WorkspaceInvitationStorePort
        const workspaceStore = yield* WorkspaceStorePort

        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* invitationStore.getManyByIds(ids).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitations'))
        )

        const uniqueWorkspaceIds = [...new Set(rows.map((row) => row.workspaceId))]
        const workspaceRoles = yield* workspaceStore
          .getMemberRolesForUser(principal.userId, uniqueWorkspaceIds)
          .pipe(Effect.mapError(() => unauthorized('Failed to verify invitation access')))

        const accessibleRows = rows.filter((invitation) =>
          hasInvitationReadAccess(
            principal.userId,
            invitation.inviteeUserId,
            workspaceRoles.get(invitation.workspaceId) ?? null
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
        const invitationStore = yield* WorkspaceInvitationStorePort
        const workspaceStore = yield* WorkspaceStorePort

        const existing = yield* invitationStore.getById(invitationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitation'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        const role = yield* workspaceStore.getMemberRole(existing.workspaceId, principal.userId).pipe(
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
        const invitationStore = yield* WorkspaceInvitationStorePort
        const workspaceStore = yield* WorkspaceStorePort

        const existing = yield* invitationStore.getById(invitationId).pipe(
          Effect.mapError(() => badRequest('Failed to fetch invitation'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Invitation not found'))
        }

        const role = yield* workspaceStore.getMemberRole(existing.workspaceId, principal.userId).pipe(
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
        const workspaceStore = yield* WorkspaceStorePort
        const invitationStore = yield* WorkspaceInvitationStorePort
        const usersPort = yield* WorkspaceUsersPort

        if (!isValidInvitationEmail(input.email)) {
          return yield* Effect.fail(badRequest('Invalid invitation payload'))
        }

        const email = normalizeInvitationEmail(input.email)

        const inviterRole = yield* workspaceStore.getMemberRole(input.workspaceId, principal.userId).pipe(
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

        const alreadyMember = yield* workspaceStore.isMember(input.workspaceId, existingUser.id).pipe(
          Effect.mapError(() => badRequest('Failed to validate existing membership'))
        )

        if (alreadyMember) {
          return yield* Effect.fail(conflict('User is already a workspace member'))
        }

        const created = yield* invitationStore.create({
          workspaceId: input.workspaceId,
          inviteeUserId: existingUser.id,
          email,
          role: input.role,
          invitedByUserId: principal.userId
        }).pipe(Effect.mapError(() => badRequest('Failed to create invitation')))

        if (!created) {
          return yield* Effect.fail(badRequest('Invitation creation failed'))
        }

        return toInvitation(created)
      }),

    acceptInvitation: (principal, token: string) =>
      Effect.gen(function* () {
        const invitationStore = yield* WorkspaceInvitationStorePort

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
