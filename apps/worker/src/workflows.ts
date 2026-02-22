import { proxyActivities } from '@temporalio/workflow'
import type { TaskProcessWorkflowInput, TaskProcessWorkflowOutput } from '@tx-agent-kit/temporal-client'
import type { activities } from './activities.js'

const { processTask } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second'
  }
})

export async function taskProcessWorkflow(input: TaskProcessWorkflowInput): Promise<TaskProcessWorkflowOutput> {
  const result = await processTask(input)

  return {
    success: !result.alreadyProcessed,
    operationId: input.operationId,
    alreadyProcessed: result.alreadyProcessed
  }
}
