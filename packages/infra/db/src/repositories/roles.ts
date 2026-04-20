import {
  asc,
  count,
  desc,
  eq,
  inArray
} from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { roleRowSchema, type RoleRowShape } from '../effect-schemas/roles.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { roles, rolePermissions, permissions } from '../schema.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeRoleRows = Schema.decodeUnknown(Schema.Array(roleRowSchema))
const decode = createOptionalDecoder(roleRowSchema, 'role row')

export const rolesRepository = {
  list: (params: ListParams) =>
    withDb('Failed to list roles', (db) =>
      Effect.gen(function* () {
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const sortColumn = sortBy === 'name' ? roles.name : roles.createdAt

        const page = yield* buildCursorPage<RoleRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy,
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db
                .select({ count: count() })
                .from(roles)
                .execute()
              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count roles', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const cursorSortValue = sortBy === 'name'
                ? (cursor?.sortValue ?? '')
                : new Date(cursor?.sortValue ?? Date.now())

              const cursorWhere = buildCursorCondition(
                cursor,
                sortOrder,
                sortColumn,
                cursorSortValue,
                roles.id
              )

              const where = cursorWhere

              const rows = yield* db
                .select({
                  id: roles.id,
                  name: roles.name,
                  isSystem: roles.isSystem,
                  createdAt: roles.createdAt
                })
                .from(roles)
                .where(where)
                .orderBy(
                  sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn),
                  sortOrder === 'asc' ? asc(roles.id) : desc(roles.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeRoleRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('role list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list roles', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) =>
            sortBy === 'name' ? row.name : row.createdAt.toISOString()
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ),

  getById: (id: string) =>
    withDb('Failed to fetch role by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: roles.id,
            name: roles.name,
            isSystem: roles.isSystem,
            createdAt: roles.createdAt
          })
          .from(roles)
          .where(eq(roles.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  getByName: (name: string) =>
    withDb('Failed to fetch role by name', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            id: roles.id,
            name: roles.name,
            isSystem: roles.isSystem,
            createdAt: roles.createdAt
          })
          .from(roles)
          .where(eq(roles.name, name))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decode)
      })
    ),

  create: (input: { name: string; permissionIds: string[] }) =>
    withDb('Failed to create role', (db) =>
      Effect.gen(function* () {
        // Insert role
        const roleRows = yield* db
          .insert(roles)
          .values({ name: input.name, isSystem: false })
          .returning()
          .execute()

        const roleOption = yield* decodeFirst(roleRows, decode)
        if (Option.isNone(roleOption)) {
          return Option.none()
        }

        const role = roleOption.value

        // Insert role_permissions
        if (input.permissionIds.length > 0) {
          yield* db
            .insert(rolePermissions)
            .values(input.permissionIds.map((permissionId) => ({
              roleId: role.id,
              permissionId
            })))
            .execute()
        }

        return Option.some(role)
      })
    ),

  update: (input: { id: string; name?: string; permissionIds?: string[] }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const row = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // Update name if provided
            if (input.name !== undefined) {
              yield* tx
                .update(roles)
                .set({ name: input.name })
                .where(eq(roles.id, input.id))
                .execute()
            }

            // Update permissions if provided — full replace
            if (input.permissionIds !== undefined) {
              // Delete existing
              yield* tx
                .delete(rolePermissions)
                .where(eq(rolePermissions.roleId, input.id))
                .execute()

              // Insert new
              if (input.permissionIds.length > 0) {
                yield* tx
                  .insert(rolePermissions)
                  .values(input.permissionIds.map((permissionId) => ({
                    roleId: input.id,
                    permissionId
                  })))
                  .execute()
              }
            }

            // Fetch updated role
            const rows = yield* tx
              .select({
                id: roles.id,
                name: roles.name,
                isSystem: roles.isSystem,
                createdAt: roles.createdAt
              })
              .from(roles)
              .where(eq(roles.id, input.id))
              .limit(1)
              .execute()

            return rows[0] ?? null
          })
        )

        return yield* decode(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update role', error))),

  remove: (id: string) =>
    withDb('Failed to delete role', (db) =>
      Effect.gen(function* () {
        yield* db
          .delete(roles)
          .where(eq(roles.id, id))
          .execute()

        return { deleted: true as const }
      })
    ),

  getPermissionIdsForRole: (roleId: string) =>
    withDb('Failed to get permission keys for role', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            key: permissions.key
          })
          .from(rolePermissions)
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(eq(rolePermissions.roleId, roleId))
          .execute()

        return rows.map((r) => r.key)
      })
    ),

  getPermissionIdsForRoles: (roleIds: string[]) =>
    withDb('Failed to get permission keys for roles', (db) =>
      Effect.gen(function* () {
        if (roleIds.length === 0) {
          return new Map<string, string[]>()
        }
        const rows = yield* db
          .select({
            roleId: rolePermissions.roleId,
            key: permissions.key
          })
          .from(rolePermissions)
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(inArray(rolePermissions.roleId, roleIds))
          .execute()

        const map = new Map<string, string[]>()
        for (const row of rows) {
          const existing = map.get(row.roleId) ?? []
          existing.push(row.key)
          map.set(row.roleId, existing)
        }
        return map
      })
    ),

  validatePermissionIds: (ids: string[]) =>
    withDb('Failed to validate permission IDs', (db) =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as string[]
        }
        // Validate by UUID (matching FK references in role_permissions)
        const rows = yield* db
          .select({ id: permissions.id })
          .from(permissions)
          .where(inArray(permissions.id, ids))
          .execute()

        return rows.map((r) => r.id)
      })
    )
}
