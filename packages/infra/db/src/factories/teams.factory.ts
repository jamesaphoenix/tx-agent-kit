import type { teams } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type TeamInsert = typeof teams.$inferInsert

export interface CreateTeamFactoryOptions {
  organizationId: string
  id?: string
  name?: string
  website?: string | null
  brandSettings?: { primaryColor?: string; logoUrl?: string; metadata?: Record<string, string> } | null
  createdAt?: Date
  updatedAt?: Date
}

export const createTeamFactory = (
  options: CreateTeamFactoryOptions
): TeamInsert => {
  return {
    id: options.id ?? generateId(),
    organizationId: options.organizationId,
    name: options.name ?? generateUniqueValue('Team'),
    website: options.website ?? null,
    brandSettings: options.brandSettings ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
