/**
 * Public cross-domain event contract for the team domain.
 *
 * This file is the ONLY file other domains may import from this domain.
 * It exposes event type discriminants, typed payload shapes, and version constants.
 *
 * Rules:
 * - Only event-related types belong here (payloads, discriminants, versions)
 * - Internal domain types, services, repos, and errors must NOT be exported here
 * - Consumers should import `type` only — these are data contracts, not runtime code
 */

export type { TeamDeletedEventPayload } from './domain/team-events.js'

export const teamEvents = {
  deleted: 'team.deleted',
} as const

export const teamEventVersions = {
  'team.deleted': 1,
} as const
