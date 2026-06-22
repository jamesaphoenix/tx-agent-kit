import { lifecycleEventTypes, type LifecycleEventType } from '@tx-agent-kit/contracts'
import type { SerializedDomainEvent } from '../activities.js'

/**
 * The user a lifecycle event enrolls. Every lifecycle.* event carries userId,
 * so one extractor covers them all (no per-event map needed). The enroll path
 * needs only the id; the sweep looks up email + name from the DB at send time.
 * Narrows with a typeof guard (never a `.payload as` cast).
 */
export interface LifecycleEnrollTarget {
  readonly userId: string
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

export const isLifecycleEventType = (eventType: string): eventType is LifecycleEventType =>
  (lifecycleEventTypes as readonly string[]).includes(eventType)

export const extractLifecycleTarget = (event: SerializedDomainEvent): LifecycleEnrollTarget | null => {
  const userId = nonEmptyString(event.payload.userId)
  if (userId === null) {
    return null
  }
  return { userId }
}
