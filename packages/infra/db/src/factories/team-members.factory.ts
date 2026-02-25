import type { teamMembers } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type TeamMemberInsert = typeof teamMembers.$inferInsert

export interface CreateTeamMemberFactoryOptions {
  teamId: string
  userId: string
  id?: string
  roleId?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export const createTeamMemberFactory = (
  options: CreateTeamMemberFactoryOptions
): TeamMemberInsert => {
  return {
    id: options.id ?? generateId(),
    teamId: options.teamId,
    userId: options.userId,
    roleId: options.roleId ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
