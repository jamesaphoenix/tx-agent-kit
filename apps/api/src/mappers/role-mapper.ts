import type { RoleWithPermissions } from '@tx-agent-kit/core'

export const toApiRole = (role: RoleWithPermissions) => ({
  id: role.id,
  name: role.name,
  isSystem: role.isSystem,
  permissions: [...role.permissions],
  createdAt: role.createdAt.toISOString()
})
