'use client'

export interface AdminResourceConfig {
  endpoint: '/v1/tasks' | '/v1/workspaces' | '/v1/invitations'
  label: string
  defaultSortBy: string
}

export const ADMIN_RESOURCES = {
  tasks: {
    endpoint: '/v1/tasks',
    label: 'Tasks',
    defaultSortBy: 'createdAt'
  },
  workspaces: {
    endpoint: '/v1/workspaces',
    label: 'Workspaces',
    defaultSortBy: 'createdAt'
  },
  invitations: {
    endpoint: '/v1/invitations',
    label: 'Invitations',
    defaultSortBy: 'createdAt'
  }
} as const satisfies Record<string, AdminResourceConfig>

export type AdminResourceName = keyof typeof ADMIN_RESOURCES
