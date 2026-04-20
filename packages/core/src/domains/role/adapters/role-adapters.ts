import { rolesRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { mapOptional, toRoleRecord, toRoleRecordPage } from '../../../adapters/db-row-mappers.js'
import type { ListParams } from '../../../pagination.js'
import { RoleStorePort } from '../ports/role-ports.js'

export const RoleStorePortLive = Layer.succeed(RoleStorePort, {
  list: (params: ListParams) =>
    rolesRepository.list(params).pipe(
      Effect.map(toRoleRecordPage)
    ),
  getById: (id: string) =>
    rolesRepository.getById(id).pipe(
      Effect.map((opt) => mapOptional(opt, toRoleRecord))
    ),
  getByName: (name: string) =>
    rolesRepository.getByName(name).pipe(
      Effect.map((opt) => mapOptional(opt, toRoleRecord))
    ),
  create: (input: { name: string; permissionIds: string[] }) =>
    rolesRepository.create(input).pipe(
      Effect.map((opt) => mapOptional(opt, toRoleRecord))
    ),
  update: (input: { id: string; name?: string; permissionIds?: string[] }) =>
    rolesRepository.update(input).pipe(
      Effect.map((opt) => mapOptional(opt, toRoleRecord))
    ),
  remove: (id: string) =>
    rolesRepository.remove(id),
  getPermissionIdsForRole: (roleId: string) =>
    rolesRepository.getPermissionIdsForRole(roleId),
  getPermissionIdsForRoles: (roleIds: string[]) =>
    rolesRepository.getPermissionIdsForRoles(roleIds),
  validatePermissionIds: (ids: string[]) =>
    rolesRepository.validatePermissionIds(ids)
})
