import { and, eq } from 'drizzle-orm'
import { db } from '../client.js'
import { workspaces, workspaceMembers } from '../schema.js'

export const workspacesRepository = {
  listForUser: async (userId: string) => {
    return db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        ownerUserId: workspaces.ownerUserId,
        createdAt: workspaces.createdAt
      })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
  },

  create: async (input: { name: string; ownerUserId: string }) => {
    const workspace = await db.insert(workspaces).values(input).returning().then((rows) => rows[0] ?? null)
    if (!workspace) return null

    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: input.ownerUserId,
      role: 'owner'
    })

    return workspace
  },

  isMember: async (workspaceId: string, userId: string) => {
    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    })
    return Boolean(member)
  }
}
