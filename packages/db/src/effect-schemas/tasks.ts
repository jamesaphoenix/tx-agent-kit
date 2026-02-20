import * as Schema from 'effect/Schema'

export const taskStatusSchema = Schema.Literal('todo', 'in_progress', 'done')

export const taskRowSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: taskStatusSchema,
  createdByUserId: Schema.UUID,
  createdAt: Schema.DateFromSelf
})

export type TaskRowShape = Schema.Schema.Type<typeof taskRowSchema>
