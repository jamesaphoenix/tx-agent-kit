import { processedOperationsRepository } from '@tx-agent-kit/db'
import { Effect } from 'effect'

export interface ProcessTaskInput {
  operationId: string
  taskId: string
  workspaceId: string
}

export const activities = {
  processTask: (input: ProcessTaskInput): Promise<{ operationId: string; alreadyProcessed: boolean }> =>
    Effect.runPromise(processedOperationsRepository.markProcessed(input))
}
