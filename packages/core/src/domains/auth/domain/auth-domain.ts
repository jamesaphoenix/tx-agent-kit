import type { User } from '@tx-agent-kit/contracts'

export interface AuthUserRecord {
  id: string
  email: string
  name: string
  createdAt: Date
}

export const toAuthUser = (row: AuthUserRecord): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt.toISOString()
})
