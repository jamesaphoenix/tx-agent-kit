import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, conflict, internalError, notFound, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type { RoleWithPermissions } from '../domain/role-domain.js'
import { RoleStorePort } from '../ports/role-ports.js'

const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)

export class RoleService extends Context.Tag('RoleService')<
  RoleService,
  {
    list: (
      params: ListParams
    ) => Effect.Effect<PaginatedResult<RoleWithPermissions>, CoreError, RoleStorePort>
    getById: (
      id: string
    ) => Effect.Effect<RoleWithPermissions, CoreError, RoleStorePort>
    create: (
      input: { name: string; permissions: string[]; principal: { userId: string } }
    ) => Effect.Effect<RoleWithPermissions, CoreError, RoleStorePort>
    update: (
      id: string,
      input: { name?: string; permissions?: string[]; principal: { userId: string } }
    ) => Effect.Effect<RoleWithPermissions, CoreError, RoleStorePort>
    remove: (
      id: string,
      opts: { principal: { userId: string } }
    ) => Effect.Effect<{ deleted: true }, CoreError, RoleStorePort>
  }
>() {}

export const RoleServiceLive = Layer.effect(
  RoleService,
  Effect.succeed({
    list: (params) =>
      Effect.gen(function* () {
        const store = yield* RoleStorePort

        const page = yield* store.list(params).pipe(
          Effect.mapError(toCoreInternal('Failed to list roles'))
        )

        // Fetch permissions for all roles in the page
        const roleIds = page.data.map((r) => r.id)
        const permMap = yield* store.getPermissionIdsForRoles([...roleIds]).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role permissions'))
        )

        return {
          data: page.data.map((role) => ({
            id: role.id,
            name: role.name,
            isSystem: role.isSystem,
            permissions: permMap.get(role.id) ?? [],
            createdAt: role.createdAt
          })),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      }),

    getById: (id) =>
      Effect.gen(function* () {
        const store = yield* RoleStorePort

        const role = yield* store.getById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Role not found')),
            onSome: Effect.succeed
          }))
        )

        const permissionIds = yield* store.getPermissionIdsForRole(role.id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role permissions'))
        )

        return {
          id: role.id,
          name: role.name,
          isSystem: role.isSystem,
          permissions: permissionIds,
          createdAt: role.createdAt
        }
      }),

    create: (input) =>
      Effect.gen(function* () {
        const store = yield* RoleStorePort

        // Check for duplicate name
        const existingOpt = yield* store.getByName(input.name).pipe(
          Effect.mapError(toCoreInternal('Failed to check role name'))
        )

        if (Option.isSome(existingOpt)) {
          return yield* Effect.fail(conflict(`Role with name '${input.name}' already exists`))
        }

        // Validate permission IDs exist
        if (input.permissions.length > 0) {
          const validIds = yield* store.validatePermissionIds(input.permissions).pipe(
            Effect.mapError(toCoreInternal('Failed to validate permission IDs'))
          )
          if (validIds.length !== input.permissions.length) {
            return yield* Effect.fail(badRequest('One or more permission IDs are invalid'))
          }
        }

        const role = yield* store.create({
          name: input.name,
          permissionIds: input.permissions
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to create role')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Role creation failed')),
            onSome: Effect.succeed
          }))
        )

        // Fetch permission IDs to return
        const permissionIds = yield* store.getPermissionIdsForRole(role.id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role permissions'))
        )

        return {
          id: role.id,
          name: role.name,
          isSystem: role.isSystem,
          permissions: permissionIds,
          createdAt: role.createdAt
        }
      }),

    update: (id, input) =>
      Effect.gen(function* () {
        const store = yield* RoleStorePort

        const existing = yield* store.getById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Role not found')),
            onSome: Effect.succeed
          }))
        )

        // System roles cannot be modified
        if (existing.isSystem) {
          return yield* Effect.fail(conflict('System roles cannot be modified'))
        }

        if (input.name === undefined && input.permissions === undefined) {
          return yield* Effect.fail(badRequest('Role update payload is empty'))
        }

        // Check for duplicate name if name is being changed
        if (input.name !== undefined && input.name !== existing.name) {
          const nameConflictOpt = yield* store.getByName(input.name).pipe(
            Effect.mapError(toCoreInternal('Failed to check role name'))
          )
          if (Option.isSome(nameConflictOpt)) {
            return yield* Effect.fail(conflict(`Role with name '${input.name}' already exists`))
          }
        }

        // Validate permission IDs exist
        if (input.permissions !== undefined && input.permissions.length > 0) {
          const validIds = yield* store.validatePermissionIds(input.permissions).pipe(
            Effect.mapError(toCoreInternal('Failed to validate permission IDs'))
          )
          if (validIds.length !== input.permissions.length) {
            return yield* Effect.fail(badRequest('One or more permission IDs are invalid'))
          }
        }

        const updated = yield* store.update({
          id,
          name: input.name,
          permissionIds: input.permissions
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to update role')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Role not found')),
            onSome: Effect.succeed
          }))
        )

        const permissionIds = yield* store.getPermissionIdsForRole(updated.id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role permissions'))
        )

        return {
          id: updated.id,
          name: updated.name,
          isSystem: updated.isSystem,
          permissions: permissionIds,
          createdAt: updated.createdAt
        }
      }),

    remove: (id, _opts) =>
      Effect.gen(function* () {
        const store = yield* RoleStorePort

        const existing = yield* store.getById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch role')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Role not found')),
            onSome: Effect.succeed
          }))
        )

        // System roles cannot be deleted
        if (existing.isSystem) {
          return yield* Effect.fail(conflict('System roles cannot be deleted'))
        }

        return yield* store.remove(id).pipe(
          Effect.mapError(toCoreInternal('Failed to delete role'))
        )
      })
  })
)
