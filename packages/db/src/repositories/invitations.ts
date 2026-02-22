import crypto from 'node:crypto'
import { and, eq, gte } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { invitationRowSchema, type InvitationRowShape } from '../effect-schemas/invitations.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { invitations, workspaceMembers } from '../schema.js'

const decodeInvitationRows = Schema.decodeUnknown(Schema.Array(invitationRowSchema))
const decodeInvitationRow = Schema.decodeUnknown(invitationRowSchema)

const decodeNullableInvitation = (
  value: unknown
): Effect.Effect<InvitationRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeInvitationRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('invitation row decode failed', error))
  )
}

export const invitationsRepository = {
  listForInviteeUserId: (inviteeUserId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: invitations.id,
            workspaceId: invitations.workspaceId,
            inviteeUserId: invitations.inviteeUserId,
            email: invitations.email,
            role: invitations.role,
            status: invitations.status,
            invitedByUserId: invitations.invitedByUserId,
            token: invitations.token,
            expiresAt: invitations.expiresAt,
            createdAt: invitations.createdAt
          })
          .from(invitations)
          .where(eq(invitations.inviteeUserId, inviteeUserId))
          .execute()

        return yield* decodeInvitationRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('invitation list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list invitations for invitee', error))),

  create: (input: {
    workspaceId: string
    inviteeUserId: string
    email: string
    role: 'admin' | 'member'
    invitedByUserId: string
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(invitations)
          .values({
            ...input,
            token: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
          })
          .returning()
          .execute()

        return yield* decodeNullableInvitation(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create invitation', error))),

  acceptByToken: (token: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const invitationRows = yield* db
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.token, token),
              eq(invitations.inviteeUserId, userId),
              eq(invitations.status, 'pending'),
              gte(invitations.expiresAt, new Date())
            )
          )
          .limit(1)
          .execute()
        const invitationRow = invitationRows[0]

        const invitation = yield* decodeNullableInvitation(invitationRow)
        if (!invitation) {
          return null
        }

        yield* db.transaction((trx) =>
          Effect.gen(function* () {
            yield* trx
              .update(invitations)
              .set({ status: 'accepted' })
              .where(eq(invitations.id, invitation.id))
              .execute()

            yield* trx
              .insert(workspaceMembers)
              .values({
                workspaceId: invitation.workspaceId,
                userId,
                role: invitation.role
              })
              .onConflictDoNothing()
              .execute()
          })
        )

        return invitation
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to accept invitation by token', error)))
}
