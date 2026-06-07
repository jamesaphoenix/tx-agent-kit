import type { UserRowShape } from '@tx-agent-kit/db'
import type { OrgMemberRole, PermissionAction } from '@tx-agent-kit/contracts'

// Extends row shape — new DB columns appear automatically.
export type AuthUserRecord = UserRowShape

// Projection of UserRowShape — excludes passwordHash, passwordChangedAt.
export type AuthUser = Pick<UserRowShape, 'id' | 'email' | 'name' | 'createdAt'>

export interface SignUpCommand {
  email: string
  password: string
  name: string
}

export interface SignInCommand {
  email: string
  password: string
}

export interface ForgotPasswordCommand {
  email: string
}

export interface ResetPasswordCommand {
  token: string
  password: string
}

export interface RefreshSessionCommand {
  refreshToken: string
}

export interface StartGoogleAuthCommand {
  ipAddress?: string
  statePrefix?: string
}

export interface CompleteGoogleAuthCommand {
  code: string
  state: string
  iss?: string
  ipAddress?: string
  userAgent?: string
}

export interface AuthSession {
  token: string
  refreshToken: string
  user: AuthUser
  principal?: AuthPrincipal
}

export interface GoogleAuthStartResult {
  authorizationUrl: string
  state: string
  expiresAt: Date
}

export interface AuthPrincipal {
  userId: string
  email: string
  sessionId?: string
  organizationId?: string
  roles: ReadonlyArray<OrgMemberRole>
  permissions?: ReadonlyArray<PermissionAction>
}

export interface AuthSessionTokenPayload {
  sub: string
  email: string
  pwd: number
  sid: string
  iat?: number
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export const isValidEmail = (email: string): boolean => emailPattern.test(normalizeEmail(email))

export const isValidDisplayName = (name: string): boolean => {
  const trimmed = name.trim()
  return trimmed.length >= 1
}

export const toAuthUser = (row: AuthUserRecord): AuthUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt
})

export const toAuthPrincipal = (
  payload: Pick<AuthSessionTokenPayload, 'sub' | 'email' | 'sid'> & {
    organizationId?: string
    role?: OrgMemberRole
    permissions?: ReadonlyArray<PermissionAction>
  }
): AuthPrincipal => ({
  userId: payload.sub,
  email: payload.email,
  sessionId: payload.sid,
  organizationId: payload.organizationId,
  roles: payload.role ? [payload.role] : [],
  permissions: payload.permissions ? [...payload.permissions] : undefined
})
