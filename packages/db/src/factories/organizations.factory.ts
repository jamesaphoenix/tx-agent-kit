import type { organizations } from '../schema.js'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type OrganizationInsert = typeof organizations.$inferInsert

export interface CreateOrganizationFactoryOptions {
  id?: string
  name?: string
  createdAt?: Date
}

export const createOrganizationFactory = (
  options: CreateOrganizationFactoryOptions = {}
): OrganizationInsert => {
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('Organization'),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
