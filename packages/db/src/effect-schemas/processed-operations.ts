import * as Schema from 'effect/Schema'

export const processedOperationRowSchema = Schema.Struct({
  operationId: Schema.String,
  workspaceId: Schema.UUID,
  taskId: Schema.UUID,
  processedAt: Schema.DateFromSelf
})

export type ProcessedOperationRowShape = Schema.Schema.Type<typeof processedOperationRowSchema>
