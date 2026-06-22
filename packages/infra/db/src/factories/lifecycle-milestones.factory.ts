import type { lifecycleMilestones } from '../schema.js'
import { generateTimestamp } from './factory-helpers.js'

type LifecycleMilestoneInsert = typeof lifecycleMilestones.$inferInsert

export interface CreateLifecycleMilestoneFactoryOptions {
  userId?: string | null
  teamId?: string | null
  milestone: string
  reachedAt?: Date
}

export const createLifecycleMilestoneFactory = (
  options: CreateLifecycleMilestoneFactoryOptions
): LifecycleMilestoneInsert => ({
  userId: options.userId ?? null,
  teamId: options.teamId ?? null,
  milestone: options.milestone,
  reachedAt: options.reachedAt ?? generateTimestamp()
})
