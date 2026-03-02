import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import {
  ParentClosePolicy,
  startChild,
  proxyActivities
} from '@temporalio/workflow'
import type { activities, SerializedDomainEvent } from './activities.js'

const {
  ping,
  fetchUnprocessedEvents,
  markEventsPublished,
  markEventFailed,
  resetStuckProcessingEvents,
  prunePublishedEvents,
  sendOrganizationWelcomeEmail
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second'
  }
})

export async function pingWorkflow(): Promise<{ ok: boolean }> {
  return ping()
}

export async function outboxPollerWorkflow(batchSize: number): Promise<void> {
  const events = await fetchUnprocessedEvents(batchSize)

  if (events.length === 0) {
    return
  }

  const dispatched: string[] = []

  for (const event of events) {
    try {
      switch (event.eventType) {
        case 'organization.created': {
          const hasValidPayload =
            typeof event.payload.organizationName === 'string'
            && typeof event.payload.ownerUserId === 'string'
            && typeof event.payload.ownerEmail === 'string'

          if (!hasValidPayload) {
            await markEventFailed(event.id, `Invalid organization.created payload for event ${event.id}: missing organizationName, ownerUserId, or ownerEmail`)
            break
          }

          await startChild(organizationCreatedWorkflow, {
            workflowId: `organization-created-${event.id}`,
            args: [event],
            parentClosePolicy: ParentClosePolicy.ABANDON,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
            workflowRunTimeout: '5 minutes'
          })
          dispatched.push(event.id)
          break
        }
        default:
          await markEventFailed(event.id, `Unknown event type '${event.eventType}'`)
          break
      }
    } catch (error: unknown) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        dispatched.push(event.id)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        await markEventFailed(event.id, `Failed to dispatch child workflow for event type '${event.eventType}': ${message}`)
      }
    }
  }

  if (dispatched.length > 0) {
    await markEventsPublished(dispatched)
  }
}

export async function organizationCreatedWorkflow(
  event: SerializedDomainEvent
): Promise<void> {
  const organizationName = typeof event.payload.organizationName === 'string'
    ? event.payload.organizationName
    : undefined
  const ownerUserId = typeof event.payload.ownerUserId === 'string'
    ? event.payload.ownerUserId
    : undefined
  const ownerEmail = typeof event.payload.ownerEmail === 'string'
    ? event.payload.ownerEmail
    : undefined

  if (!organizationName || !ownerUserId || !ownerEmail) {
    throw new Error(
      `Invalid organization.created payload for event ${event.id}: missing organizationName, ownerUserId, or ownerEmail`
    )
  }

  await sendOrganizationWelcomeEmail({ organizationName, ownerUserId, ownerEmail })
}

export async function resetStuckEventsWorkflow(
  stuckThresholdMinutes: number
): Promise<ReadonlyArray<string>> {
  return resetStuckProcessingEvents(stuckThresholdMinutes)
}

export async function prunePublishedEventsWorkflow(
  retentionDays: number
): Promise<number> {
  return prunePublishedEvents(retentionDays)
}

