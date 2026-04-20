import type { ContentReviewTokenRecord, TeamMemberRecord } from '@tx-agent-kit/core'
import type { ReviewTokenPermission } from '@tx-agent-kit/contracts'

export const toApiTeam = (team: {
  id: string
  organizationId: string
  name: string
  website: string | null
  brandSettings: {
    colors: { primary: string; secondary: string; accent: string; background: string; text: string }
    brandGuidelines: string
    industry: string
    targetAudience: string
  } | null
  createdAt: Date
  updatedAt: Date
}) => ({
  id: team.id,
  organizationId: team.organizationId,
  name: team.name,
  website: team.website,
  brandSettings: team.brandSettings ?? null,
  createdAt: team.createdAt.toISOString(),
  updatedAt: team.updatedAt.toISOString()
})

export const toApiTeamMember = (member: TeamMemberRecord) => ({
  id: member.id,
  teamId: member.teamId,
  userId: member.userId,
  roleId: member.roleId,
  role: member.role,
  disabledAt: member.disabledAt?.toISOString() ?? null,
  createdAt: member.createdAt.toISOString(),
  updatedAt: member.updatedAt.toISOString()
})

export const toApiReviewToken = (token: ContentReviewTokenRecord) => ({
  id: token.id,
  teamId: token.teamId,
  token: token.token,
  expiresAt: token.expiresAt.toISOString(),
  revokedAt: token.revokedAt?.toISOString() ?? null,
  permissions: [...token.permissions] as ReviewTokenPermission[],
  reviewerName: token.reviewerName,
  reviewerEmail: token.reviewerEmail,
  lastAccessedAt: token.lastAccessedAt?.toISOString() ?? null,
  createdBy: token.createdBy,
  createdAt: token.createdAt.toISOString()
})
