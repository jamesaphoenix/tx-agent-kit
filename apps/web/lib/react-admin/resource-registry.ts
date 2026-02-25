'use client'

export interface AdminResourceConfig {
  endpoint: '/v1/organizations' | '/v1/invitations'
  label: string
  defaultSortBy: string
}

export const ADMIN_RESOURCES = {
  organizations: {
    endpoint: '/v1/organizations',
    label: 'Organizations',
    defaultSortBy: 'createdAt'
  },
  invitations: {
    endpoint: '/v1/invitations',
    label: 'Invitations',
    defaultSortBy: 'createdAt'
  }
} as const satisfies Record<string, AdminResourceConfig>

export type AdminResourceName = keyof typeof ADMIN_RESOURCES
