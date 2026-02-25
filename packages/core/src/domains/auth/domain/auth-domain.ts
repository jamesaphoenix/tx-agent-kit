export interface AuthUserRecord {
  id: string
  email: string
  passwordHash: string
  passwordChangedAt: Date
  name: string
  createdAt: Date
}

export interface AuthUser {
  id: string
  email: string
  name: string
  createdAt: Date
}

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

export interface AuthSession {
  token: string
  user: AuthUser
}

export interface AuthPrincipal {
  userId: string
  email: string
  organizationId?: string
  roles: ReadonlyArray<string>
}

export interface AuthSessionTokenPayload {
  sub: string
  email: string
  pwd: number
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

export const toAuthPrincipal = (payload: Pick<AuthSessionTokenPayload, 'sub' | 'email'>): AuthPrincipal => ({
  userId: payload.sub,
  email: payload.email,
  roles: ['member']
})
