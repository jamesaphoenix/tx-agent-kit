import * as Schema from 'effect/Schema'
import { paginatedResponseSchema } from './common.js'

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

export const updateTaskRequestSchema = Schema.Struct({
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200))),
  description: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(2000)))),
  status: Schema.optional(taskStatusSchema)
})

export const listTasksResponseSchema = paginatedResponseSchema(taskSchema)

export type Task = Schema.Schema.Type<typeof taskSchema>
export type CreateTaskRequest = Schema.Schema.Type<typeof createTaskRequestSchema>
export type UpdateTaskRequest = Schema.Schema.Type<typeof updateTaskRequestSchema>
