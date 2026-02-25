import * as Schema from 'effect/Schema'

export const TaskProcessWorkflowInputSchema = Schema.Struct({
  operationId: Schema.String,
  taskId: Schema.String,
  organizationId: Schema.String
})

export type TaskProcessWorkflowInput = Schema.Schema.Type<typeof TaskProcessWorkflowInputSchema>

export const TaskProcessWorkflowOutputSchema = Schema.Struct({
  success: Schema.Boolean,
  operationId: Schema.String,
  alreadyProcessed: Schema.Boolean
})

export type TaskProcessWorkflowOutput = Schema.Schema.Type<typeof TaskProcessWorkflowOutputSchema>
