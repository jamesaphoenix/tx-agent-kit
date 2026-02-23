import type { AuthPrincipal, AuthSession, AuthUser } from '@tx-agent-kit/core'

export const toApiAuthUser = (user: AuthUser) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt.toISOString()
})

export const toApiAuthSession = (session: AuthSession) => ({
  token: session.token,
  user: toApiAuthUser(session.user)
})

export const toApiAuthPrincipal = (principal: AuthPrincipal) => ({
  userId: principal.userId,
  email: principal.email,
  workspaceId: principal.workspaceId,
  roles: [...principal.roles]
})
