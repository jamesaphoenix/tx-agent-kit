import type { Invitation, Workspace } from '@tx-agent-kit/contracts'
import { createInvitationRequestSchema, createWorkspaceRequestSchema } from '@tx-agent-kit/contracts'
import { Context, Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import { toInvitation, toWorkspace } from '../domain/workspace-domain.js'
import {
  WorkspaceInvitationStorePort,
  WorkspaceStorePort,
  WorkspaceUsersPort
} from '../ports/workspace-ports.js'

export class WorkspaceService extends Context.Tag('WorkspaceService')<
  WorkspaceService,
  {
    listForUser: (userId: string) => Effect.Effect<{ workspaces: Workspace[] }, CoreError, WorkspaceStorePort>
    createForUser: (userId: string, input: unknown) => Effect.Effect<Workspace, CoreError, WorkspaceStorePort>
    listInvitationsForUser: (
      userId: string
    ) => Effect.Effect<{ invitations: Invitation[] }, CoreError, WorkspaceInvitationStorePort>
    createInvitation: (
      principal: { userId: string; email: string },
      input: unknown
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
    listForUser: (userId: string) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort
        const rows = yield* workspaceStore.listForUser(userId).pipe(
          Effect.mapError(() => badRequest('Failed to list workspaces'))
        )
        return { workspaces: rows.map(toWorkspace) }
      }),

    createForUser: (userId: string, input: unknown) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort

        const parsed = yield* Schema.decodeUnknown(createWorkspaceRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid workspace payload'))
        )

        const created = yield* workspaceStore.create({ name: parsed.name, ownerUserId: userId }).pipe(
          Effect.mapError(() => badRequest('Failed to create workspace'))
        )

        if (!created) {
          return yield* Effect.fail(badRequest('Workspace creation failed'))
        }

        return toWorkspace(created)
      }),

    listInvitationsForUser: (userId: string) =>
      Effect.gen(function* () {
        const invitationStore = yield* WorkspaceInvitationStorePort
        const rows = yield* invitationStore.listForInviteeUserId(userId).pipe(
          Effect.mapError(() => badRequest('Failed to list invitations'))
        )

        return { invitations: rows.map(toInvitation) }
      }),

    createInvitation: (principal, input: unknown) =>
      Effect.gen(function* () {
        const workspaceStore = yield* WorkspaceStorePort
        const invitationStore = yield* WorkspaceInvitationStorePort
        const usersPort = yield* WorkspaceUsersPort

        const parsed = yield* Schema.decodeUnknown(createInvitationRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid invitation payload'))
        )

        const inviterRole = yield* workspaceStore.getMemberRole(parsed.workspaceId, principal.userId).pipe(
          Effect.mapError(() => unauthorized('Not allowed to invite'))
        )

        if (!inviterRole) {
          return yield* Effect.fail(unauthorized('Not allowed to invite'))
        }

        if (inviterRole === 'member') {
          return yield* Effect.fail(unauthorized('Only admins and owners can create invitations'))
        }

        const existingUser = yield* usersPort.findByEmail(parsed.email).pipe(
          Effect.mapError(() => badRequest('Failed to look up invited user'))
        )

        if (!existingUser) {
          return yield* Effect.fail(badRequest('Invited user must already have an account'))
        }

        const alreadyMember = yield* workspaceStore.isMember(parsed.workspaceId, existingUser.id).pipe(
          Effect.mapError(() => badRequest('Failed to validate existing membership'))
        )

        if (alreadyMember) {
          return yield* Effect.fail(conflict('User is already a workspace member'))
        }

        const created = yield* invitationStore.create({
          workspaceId: parsed.workspaceId,
          inviteeUserId: existingUser.id,
          email: parsed.email,
          role: parsed.role,
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
