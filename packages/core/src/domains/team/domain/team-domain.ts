import type {
  TeamRowShape,
  TeamMemberRowShape,
  ContentReviewTokenRowShape
} from '@tx-agent-kit/db'

export interface BrandSettingsShape {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
  }
  brandGuidelines: string
  industry: string
  targetAudience: string
}

// Extends row shape — new DB columns appear automatically.
export type TeamRecord = TeamRowShape

export type TeamMemberRecord = TeamMemberRowShape

// ContentReviewTokenRowShape uses `string[]`; domain wants `readonly string[]`.
export interface ContentReviewTokenRecord extends Omit<ContentReviewTokenRowShape, 'permissions'> {
  readonly permissions: readonly string[]
}

export interface CreateTeamCommand {
  organizationId: string
  name: string
  website?: string | null
  brandSettings: BrandSettingsShape
}

export interface UpdateTeamCommand {
  name?: string
  website?: string | null
  brandSettings?: BrandSettingsShape | null
}

const minTeamNameLength = 2
const maxTeamNameLength = 64
const hexColorPattern = /^#[0-9a-fA-F]{6}$/

export const normalizeTeamName = (name: string): string => name.trim()

export const isValidTeamName = (name: string): boolean => {
  const trimmed = normalizeTeamName(name)
  return trimmed.length >= minTeamNameLength && trimmed.length <= maxTeamNameLength
}

export const isValidHexColor = (value: string): boolean =>
  hexColorPattern.test(value)

export const isValidBrandSettings = (settings: BrandSettingsShape): boolean => {
  const { colors, brandGuidelines, industry, targetAudience } = settings
  if (!isValidHexColor(colors.primary)) {return false}
  if (!isValidHexColor(colors.secondary)) {return false}
  if (!isValidHexColor(colors.accent)) {return false}
  if (!isValidHexColor(colors.background)) {return false}
  if (!isValidHexColor(colors.text)) {return false}
  if (brandGuidelines.length > 500) {return false}
  if (industry.length > 100) {return false}
  if (targetAudience.length > 500) {return false}
  return true
}
