import * as Schema from 'effect/Schema'

export const taskStatusSchema = Schema.Literal('todo', 'in_progress', 'done')

export const taskSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: taskStatusSchema,
  createdByUserId: Schema.UUID,
  createdAt: Schema.String
})

export const createTaskRequestSchema = Schema.Struct({
  workspaceId: Schema.UUID,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.optional(Schema.String.pipe(Schema.maxLength(2000)))
})

export const listTasksResponseSchema = Schema.Struct({
  tasks: Schema.Array(taskSchema)
})

export type Task = Schema.Schema.Type<typeof taskSchema>
export type CreateTaskRequest = Schema.Schema.Type<typeof createTaskRequestSchema>
