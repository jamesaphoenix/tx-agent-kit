import type { AutoFixAgentKind, AutoFixEnvironment, AutoFixRunStatus } from '@tx-agent-kit/contracts'
import type { autoFixRuns, JsonObject } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type AutoFixRunInsert = typeof autoFixRuns.$inferInsert

export interface CreateAutoFixRunFactoryOptions {
  id?: string
  sentryIssueId?: string
  environment?: AutoFixEnvironment
  fingerprint?: string | null
  title?: string
  permalink?: string | null
  status?: AutoFixRunStatus
  branch?: string | null
  agent?: AutoFixAgentKind | null
  agentOutput?: JsonObject | null
  agentJsonlOutput?: string | null
  prUrl?: string | null
  agentError?: string | null
  startedAt?: Date | null
  completedAt?: Date | null
  createdAt?: Date
}

/**
 * Factory for the `auto_fix_runs` operational table. Keeps test seeding in sync
 * with the schema. Defaults to a freshly-inserted `pending` row (the shape the
 * webhook handler creates before starting the Temporal workflow); the agent
 * columns default to `null` until the host worker's activity records a result.
 */
export const createAutoFixRunFactory = (
  options: CreateAutoFixRunFactoryOptions = {}
): AutoFixRunInsert => ({
  id: options.id ?? generateId(),
  sentryIssueId: options.sentryIssueId ?? generateUniqueValue('sentry-issue'),
  environment: options.environment ?? 'staging',
  title: options.title ?? 'TypeError: cannot read property of undefined',
  permalink: options.permalink ?? null,
  fingerprint: options.fingerprint ?? null,
  status: options.status ?? 'pending',
  branch: options.branch ?? null,
  agent: options.agent ?? null,
  agentOutput: options.agentOutput ?? null,
  agentJsonlOutput: options.agentJsonlOutput ?? null,
  prUrl: options.prUrl ?? null,
  agentError: options.agentError ?? null,
  startedAt: options.startedAt ?? null,
  completedAt: options.completedAt ?? null,
  createdAt: options.createdAt ?? generateTimestamp()
})
