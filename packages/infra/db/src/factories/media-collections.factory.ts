import type { mediaCollections } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type MediaCollectionInsert = typeof mediaCollections.$inferInsert

export interface CreateMediaCollectionFactoryOptions {
  teamId: string
  id?: string
  name?: string
  description?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export const createMediaCollectionFactory = (
  options: CreateMediaCollectionFactoryOptions
): MediaCollectionInsert => {
  return {
    id: options.id ?? generateId(),
    teamId: options.teamId,
    name: options.name ?? generateUniqueValue('Collection'),
    description: options.description ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
