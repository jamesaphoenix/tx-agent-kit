import { desc, eq } from 'drizzle-orm'
import { db } from '../client.js'
import { tasks } from '../schema.js'

export const tasksRepository = {
  listByWorkspace: (workspaceId: string) =>
    db
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        createdByUserId: tasks.createdByUserId,
        createdAt: tasks.createdAt
      })
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
      .orderBy(desc(tasks.createdAt)),

  create: (input: { workspaceId: string; title: string; description?: string; createdByUserId: string }) =>
    db
      .insert(tasks)
      .values({
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        createdByUserId: input.createdByUserId,
        status: 'todo'
      })
      .returning()
      .then((rows) => rows[0] ?? null)
}
