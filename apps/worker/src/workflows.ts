import { proxyActivities } from '@temporalio/workflow'
import type { activities } from './activities.js'

const { processTask } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second'
  }
})

export interface TaskProcessWorkflowInput {
  operationId: string
  taskId: string
  workspaceId: string
}

export async function taskProcessWorkflow(input: TaskProcessWorkflowInput): Promise<{ success: boolean; operationId: string }> {
  await processTask(input)

  return {
    success: true,
    operationId: input.operationId
  }
}
