import { proxyActivities } from '@temporalio/workflow'
import type { activities } from './activities.js'

const { ping } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second'
  }
})

export async function pingWorkflow(): Promise<{ ok: boolean }> {
  return ping()
}
