import type { processedOperations } from '../schema.js'
import { generateTimestamp } from './factory-helpers.js'

type ProcessedOperationInsert = typeof processedOperations.$inferInsert

export interface CreateProcessedOperationFactoryOptions {
  operationId: string
  workspaceId: string
  taskId: string
  processedAt?: Date
}

export const createProcessedOperationFactory = (
  options: CreateProcessedOperationFactoryOptions
): ProcessedOperationInsert => {
  return {
    operationId: options.operationId,
    workspaceId: options.workspaceId,
    taskId: options.taskId,
    processedAt: options.processedAt ?? generateTimestamp()
  }
}
