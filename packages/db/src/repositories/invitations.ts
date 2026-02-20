import crypto from 'node:crypto'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '../client.js'
import { invitations, workspaceMembers } from '../schema.js'

export const invitationsRepository = {
  listForUserWorkspaces: async (userId: string) => {
    return db
      .select({
        id: invitations.id,
        workspaceId: invitations.workspaceId,
        email: invitations.email,
        role: invitations.role,
        status: invitations.status,
        invitedByUserId: invitations.invitedByUserId,
        token: invitations.token,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt
      })
      .from(invitations)
      .innerJoin(workspaceMembers, eq(invitations.workspaceId, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
  },

  create: (input: { workspaceId: string; email: string; role: 'admin' | 'member'; invitedByUserId: string }) =>
    db
      .insert(invitations)
      .values({
        ...input,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
      })
      .returning()
      .then((rows) => rows[0] ?? null),

  acceptByToken: async (token: string, userId: string, email: string) => {
    const invitation = await db.query.invitations.findFirst({
      where: and(
        eq(invitations.token, token),
        eq(invitations.email, email),
        eq(invitations.status, 'pending'),
        gte(invitations.expiresAt, new Date())
      )
    })

    if (!invitation) return null

    await db.transaction(async (trx) => {
      await trx
        .update(invitations)
        .set({ status: 'accepted' })
        .where(eq(invitations.id, invitation.id))

      await trx
        .insert(workspaceMembers)
        .values({
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role
        })
        .onConflictDoNothing()
    })

    return invitation
  }
}
