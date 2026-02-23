import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import {
  TaskProcessWorkflowInputSchema,
  TaskProcessWorkflowOutputSchema
} from './task-process.js'

describe('task process workflow schemas', () => {
  it('decodes valid workflow input and output payloads', () => {
    const decodeInput = Schema.decodeUnknownSync(TaskProcessWorkflowInputSchema)
    const decodeOutput = Schema.decodeUnknownSync(TaskProcessWorkflowOutputSchema)

    const input = decodeInput({
      operationId: 'op-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1'
    })
    const output = decodeOutput({
      success: true,
      operationId: 'op-1',
      alreadyProcessed: false
    })

    expect(input).toEqual({
      operationId: 'op-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1'
    })
    expect(output).toEqual({
      success: true,
      operationId: 'op-1',
      alreadyProcessed: false
    })
  })

  it('rejects invalid payload shapes', () => {
    const decodeInput = Schema.decodeUnknownSync(TaskProcessWorkflowInputSchema)
    const decodeOutput = Schema.decodeUnknownSync(TaskProcessWorkflowOutputSchema)

    expect(() =>
      decodeInput({
        operationId: 'op-1',
        taskId: 123,
        workspaceId: 'workspace-1'
      })
    ).toThrow()

    expect(() =>
      decodeOutput({
        success: true,
        operationId: 'op-1',
        alreadyProcessed: 'no'
      })
    ).toThrow()
  })
})
