import type { AuthPrincipal, AuthSession, AuthUser } from '@tx-agent-kit/core'

export const toApiAuthUser = (user: AuthUser) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt.toISOString()
})

export interface ToApiAuthSessionOptions {
  includeRefreshToken?: boolean
}

export const toApiAuthSession = (
  session: AuthSession,
  options: ToApiAuthSessionOptions = {}
) => ({
  token: session.token,
  ...(options.includeRefreshToken === true ? { refreshToken: session.refreshToken } : {}),
  user: toApiAuthUser(session.user),
  ...(session.principal ? { principal: toApiAuthPrincipal(session.principal) } : {})
})

export const toApiAuthPrincipal = (principal: AuthPrincipal) => ({
  userId: principal.userId,
  email: principal.email,
  organizationId: principal.organizationId,
  roles: [...principal.roles] as AuthPrincipal['roles'],
  permissions: principal.permissions ? [...principal.permissions] : []
})
