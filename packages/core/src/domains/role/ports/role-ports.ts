import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { RoleRecord } from '../domain/role-domain.js'

export type { RoleRecord }

export const RoleRepositoryKind = 'crud' as const

export class RoleStorePort extends Context.Tag('RoleStorePort')<
  RoleStorePort,
  {
    list: (params: ListParams) => Effect.Effect<PaginatedResult<RoleRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    getByName: (name: string) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    create: (input: { name: string; permissionIds: string[] }) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    update: (input: { id: string; name?: string; permissionIds?: string[] }) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    getPermissionIdsForRole: (roleId: string) => Effect.Effect<string[], unknown>
    getPermissionIdsForRoles: (roleIds: string[]) => Effect.Effect<Map<string, string[]>, unknown>
    validatePermissionIds: (ids: string[]) => Effect.Effect<string[], unknown>
  }
>() {}
