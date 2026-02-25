export interface TeamRecord {
  id: string
  organizationId: string
  name: string
  website: string | null
  brandSettings: { primaryColor?: string; logoUrl?: string; metadata?: Record<string, string> } | null
  createdAt: Date
  updatedAt: Date
}

export interface TeamMemberRecord {
  id: string
  teamId: string
  userId: string
  roleId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Team {
  id: string
  organizationId: string
  name: string
  website: string | null
  brandSettings: { primaryColor?: string; logoUrl?: string; metadata?: Record<string, string> } | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateTeamCommand {
  organizationId: string
  name: string
}

export interface UpdateTeamCommand {
  name?: string
}

const minTeamNameLength = 2
const maxTeamNameLength = 64

export const normalizeTeamName = (name: string): string => name.trim()

export const isValidTeamName = (name: string): boolean => {
  const trimmed = normalizeTeamName(name)
  return trimmed.length >= minTeamNameLength && trimmed.length <= maxTeamNameLength
}

export const toTeam = (row: TeamRecord): Team => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  website: row.website,
  brandSettings: row.brandSettings,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})
