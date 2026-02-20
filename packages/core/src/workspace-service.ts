import type { Invitation, Workspace } from '@tx-agent-kit/contracts'
import { createInvitationRequestSchema, createWorkspaceRequestSchema } from '@tx-agent-kit/contracts'
import { invitationsRepository, usersRepository, workspacesRepository } from '@tx-agent-kit/db'
import { Context, Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from './errors.js'

const toWorkspace = (row: { id: string; name: string; ownerUserId: string; createdAt: Date }): Workspace => ({
  id: row.id,
  name: row.name,
  ownerUserId: row.ownerUserId,
  createdAt: row.createdAt.toISOString()
})

const toInvitation = (row: {
  id: string
  workspaceId: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}): Invitation => ({
  id: row.id,
  workspaceId: row.workspaceId,
  email: row.email,
  role: row.role === 'owner' ? 'admin' : row.role,
  status: row.status,
  invitedByUserId: row.invitedByUserId,
  token: row.token,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString()
})

export class WorkspaceService extends Context.Tag('WorkspaceService')<
  WorkspaceService,
  {
    listForUser: (userId: string) => Effect.Effect<{ workspaces: Workspace[] }, CoreError>
    createForUser: (userId: string, input: unknown) => Effect.Effect<Workspace, CoreError>
    listInvitationsForUser: (userId: string) => Effect.Effect<{ invitations: Invitation[] }, CoreError>
    createInvitation: (principal: { userId: string; email: string }, input: unknown) => Effect.Effect<Invitation, CoreError>
    acceptInvitation: (principal: { userId: string; email: string }, token: string) => Effect.Effect<{ accepted: true }, CoreError>
  }
>() {}

export const WorkspaceServiceLive = Layer.effect(
  WorkspaceService,
  Effect.succeed({
    listForUser: (userId: string) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await workspacesRepository.listForUser(userId)
          return { workspaces: rows.map(toWorkspace) }
        },
        catch: () => badRequest('Failed to list workspaces')
      }),

    createForUser: (userId: string, input: unknown) =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(createWorkspaceRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid workspace payload'))
        )

        const created = yield* Effect.tryPromise({
          try: () => workspacesRepository.create({ name: parsed.name, ownerUserId: userId }),
          catch: () => badRequest('Failed to create workspace')
        })

        if (!created) {
          return yield* Effect.fail(badRequest('Workspace creation failed'))
        }

        return toWorkspace(created)
      }),

    listInvitationsForUser: (userId: string) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await invitationsRepository.listForUserWorkspaces(userId)
          return { invitations: rows.map(toInvitation) }
        },
        catch: () => badRequest('Failed to list invitations')
      }),

    createInvitation: (principal, input: unknown) =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknown(createInvitationRequestSchema)(input).pipe(
          Effect.mapError(() => badRequest('Invalid invitation payload'))
        )

        const isMember = yield* Effect.tryPromise({
          try: () => workspacesRepository.isMember(parsed.workspaceId, principal.userId),
          catch: () => unauthorized('Not allowed to invite')
        })

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to invite'))
        }

        const existingUser = yield* Effect.tryPromise({
          try: () => usersRepository.findByEmail(parsed.email),
          catch: () => badRequest('Failed to look up invited user')
        })

        if (existingUser) {
          const alreadyMember = yield* Effect.tryPromise({
            try: () => workspacesRepository.isMember(parsed.workspaceId, existingUser.id),
            catch: () => badRequest('Failed to validate existing membership')
          })

          if (alreadyMember) {
            return yield* Effect.fail(conflict('User is already a workspace member'))
          }
        }

        const created = yield* Effect.tryPromise({
          try: () =>
            invitationsRepository.create({
              workspaceId: parsed.workspaceId,
              email: parsed.email,
              role: parsed.role,
              invitedByUserId: principal.userId
            }),
          catch: () => badRequest('Failed to create invitation')
        })

        if (!created) {
          return yield* Effect.fail(badRequest('Invitation creation failed'))
        }

        return toInvitation(created)
      }),

    acceptInvitation: (principal, token: string) =>
      Effect.gen(function* () {
        if (!token) {
          return yield* Effect.fail(badRequest('Missing invitation token'))
        }

        const accepted = yield* Effect.tryPromise({
          try: () => invitationsRepository.acceptByToken(token, principal.userId, principal.email),
          catch: () => badRequest('Failed to accept invitation')
        })

        if (!accepted) {
          return yield* Effect.fail(notFound('Invitation not found or expired'))
        }

        return { accepted: true as const }
      })
  })
)
