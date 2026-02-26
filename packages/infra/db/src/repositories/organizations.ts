import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  type SQL
} from 'drizzle-orm'
import { type OrgMemberRole } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorPage } from '../pagination.js'
import { organizationRowSchema, type OrganizationRowShape } from '../effect-schemas/organizations.js'
import { orgMemberRowSchema, type OrgMemberRowShape } from '../effect-schemas/org-members.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { organizations, orgMembers } from '../schema.js'
import type { ListParams } from './list-params.js'

const decodeOrganizationRows = Schema.decodeUnknown(Schema.Array(organizationRowSchema))
const decodeOrganizationRow = Schema.decodeUnknown(organizationRowSchema)
const decodeOrgMemberRow = Schema.decodeUnknown(orgMemberRowSchema)

const decodeNullableOrganization = (
  value: unknown
): Effect.Effect<OrganizationRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeOrganizationRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('organization row decode failed', error))
  )
}

const decodeNullableOrgMember = (
  value: unknown
): Effect.Effect<OrgMemberRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeOrgMemberRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('org member row decode failed', error))
  )
}

const parseCountValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

const buildListWhere = (userId: string): SQL<unknown> =>
  eq(orgMembers.userId, userId)

export const organizationsRepository = {
  list: (userId: string, params: ListParams) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const sortBy = params.sortBy
        const sortOrder = params.sortOrder
        const baseWhere = buildListWhere(userId)

        const page = yield* buildCursorPage<OrganizationRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy,
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db
                .select({
                  count: count()
                })
                .from(organizations)
                .innerJoin(orgMembers, eq(orgMembers.organizationId, organizations.id))
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count organizations for user', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              if (sortBy === 'name') {
                const cursorWhere = cursor
                  ? sortOrder === 'asc'
                    ? or(
                        gt(organizations.name, cursor.sortValue),
                        and(eq(organizations.name, cursor.sortValue), gt(organizations.id, cursor.id))
                      )
                    : or(
                        lt(organizations.name, cursor.sortValue),
                        and(eq(organizations.name, cursor.sortValue), lt(organizations.id, cursor.id))
                      )
                  : undefined

                const rows = yield* db
                  .select({
                    id: organizations.id,
                    name: organizations.name,
                    billingEmail: organizations.billingEmail,
                    onboardingData: organizations.onboardingData,
                    stripeCustomerId: organizations.stripeCustomerId,
                    stripeSubscriptionId: organizations.stripeSubscriptionId,
                    stripePaymentMethodId: organizations.stripePaymentMethodId,
                    stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
                    creditsBalance: organizations.creditsBalance,
                    reservedCredits: organizations.reservedCredits,
                    autoRechargeEnabled: organizations.autoRechargeEnabled,
                    autoRechargeThreshold: organizations.autoRechargeThreshold,
                    autoRechargeAmount: organizations.autoRechargeAmount,
                    isSubscribed: organizations.isSubscribed,
                    subscriptionStatus: organizations.subscriptionStatus,
                    subscriptionPlan: organizations.subscriptionPlan,
                    subscriptionStartedAt: organizations.subscriptionStartedAt,
                    subscriptionEndsAt: organizations.subscriptionEndsAt,
                    subscriptionCurrentPeriodEnd: organizations.subscriptionCurrentPeriodEnd,
                    createdAt: organizations.createdAt,
                    updatedAt: organizations.updatedAt
                  })
                  .from(organizations)
                  .innerJoin(orgMembers, eq(orgMembers.organizationId, organizations.id))
                  .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                  .orderBy(
                    sortOrder === 'asc' ? asc(organizations.name) : desc(organizations.name),
                    sortOrder === 'asc' ? asc(organizations.id) : desc(organizations.id)
                  )
                  .limit(limitPlusOne)
                  .execute()

                return yield* decodeOrganizationRows(rows).pipe(
                  Effect.mapError((error) => dbDecodeFailed('organization list decode failed', error))
                )
              }

              const cursorWhere = cursor
                ? sortOrder === 'asc'
                  ? or(
                      gt(organizations.createdAt, new Date(cursor.sortValue)),
                      and(eq(organizations.createdAt, new Date(cursor.sortValue)), gt(organizations.id, cursor.id))
                    )
                  : or(
                      lt(organizations.createdAt, new Date(cursor.sortValue)),
                      and(eq(organizations.createdAt, new Date(cursor.sortValue)), lt(organizations.id, cursor.id))
                    )
                : undefined

              const rows = yield* db
                .select({
                  id: organizations.id,
                  name: organizations.name,
                  billingEmail: organizations.billingEmail,
                  onboardingData: organizations.onboardingData,
                  stripeCustomerId: organizations.stripeCustomerId,
                  stripeSubscriptionId: organizations.stripeSubscriptionId,
                  stripePaymentMethodId: organizations.stripePaymentMethodId,
                  stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
                  creditsBalance: organizations.creditsBalance,
                  reservedCredits: organizations.reservedCredits,
                  autoRechargeEnabled: organizations.autoRechargeEnabled,
                  autoRechargeThreshold: organizations.autoRechargeThreshold,
                  autoRechargeAmount: organizations.autoRechargeAmount,
                  isSubscribed: organizations.isSubscribed,
                  subscriptionStatus: organizations.subscriptionStatus,
                  subscriptionPlan: organizations.subscriptionPlan,
                  subscriptionStartedAt: organizations.subscriptionStartedAt,
                  subscriptionEndsAt: organizations.subscriptionEndsAt,
                  subscriptionCurrentPeriodEnd: organizations.subscriptionCurrentPeriodEnd,
                  createdAt: organizations.createdAt,
                  updatedAt: organizations.updatedAt
                })
                .from(organizations)
                .innerJoin(orgMembers, eq(orgMembers.organizationId, organizations.id))
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(organizations.createdAt) : desc(organizations.createdAt),
                  sortOrder === 'asc' ? asc(organizations.id) : desc(organizations.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeOrganizationRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('organization list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list organizations for user', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => {
            if (sortBy === 'name') {
              return row.name
            }

            return row.createdAt.toISOString()
          }
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list organizations for user', error))),

  listForUser: (userId: string, params: ListParams) =>
    organizationsRepository.list(userId, params),

  getById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: organizations.id,
            name: organizations.name,
            billingEmail: organizations.billingEmail,
            onboardingData: organizations.onboardingData,
            stripeCustomerId: organizations.stripeCustomerId,
            stripeSubscriptionId: organizations.stripeSubscriptionId,
            stripePaymentMethodId: organizations.stripePaymentMethodId,
            stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
            creditsBalance: organizations.creditsBalance,
            reservedCredits: organizations.reservedCredits,
            autoRechargeEnabled: organizations.autoRechargeEnabled,
            autoRechargeThreshold: organizations.autoRechargeThreshold,
            autoRechargeAmount: organizations.autoRechargeAmount,
            isSubscribed: organizations.isSubscribed,
            subscriptionStatus: organizations.subscriptionStatus,
            subscriptionPlan: organizations.subscriptionPlan,
            subscriptionStartedAt: organizations.subscriptionStartedAt,
            subscriptionEndsAt: organizations.subscriptionEndsAt,
            subscriptionCurrentPeriodEnd: organizations.subscriptionCurrentPeriodEnd,
            createdAt: organizations.createdAt,
            updatedAt: organizations.updatedAt
          })
          .from(organizations)
          .where(eq(organizations.id, id))
          .limit(1)
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch organization by id', error))),

  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as const
        }

        const db = yield* DB
        const rows = yield* db
          .select({
            id: organizations.id,
            name: organizations.name,
            billingEmail: organizations.billingEmail,
            onboardingData: organizations.onboardingData,
            stripeCustomerId: organizations.stripeCustomerId,
            stripeSubscriptionId: organizations.stripeSubscriptionId,
            stripePaymentMethodId: organizations.stripePaymentMethodId,
            stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
            creditsBalance: organizations.creditsBalance,
            reservedCredits: organizations.reservedCredits,
            autoRechargeEnabled: organizations.autoRechargeEnabled,
            autoRechargeThreshold: organizations.autoRechargeThreshold,
            autoRechargeAmount: organizations.autoRechargeAmount,
            isSubscribed: organizations.isSubscribed,
            subscriptionStatus: organizations.subscriptionStatus,
            subscriptionPlan: organizations.subscriptionPlan,
            subscriptionStartedAt: organizations.subscriptionStartedAt,
            subscriptionEndsAt: organizations.subscriptionEndsAt,
            subscriptionCurrentPeriodEnd: organizations.subscriptionCurrentPeriodEnd,
            createdAt: organizations.createdAt,
            updatedAt: organizations.updatedAt
          })
          .from(organizations)
          .innerJoin(orgMembers, eq(orgMembers.organizationId, organizations.id))
          .where(and(
            eq(orgMembers.userId, userId),
            inArray(organizations.id, [...ids])
          ))
          .execute()

        return yield* decodeOrganizationRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('organization list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch organizations by ids for user', error))),

  create: (input: { name: string; ownerUserId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const orgRows = yield* trx
              .insert(organizations)
              .values({ name: input.name })
              .returning()
              .execute()

            const org = orgRows[0]
            if (!org) {
              return null
            }

            yield* trx
              .insert(orgMembers)
              .values({
                organizationId: org.id,
                userId: input.ownerUserId,
                role: 'owner'
              })
              .execute()

            return org
          })
        )

        return yield* decodeNullableOrganization(result)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create organization', error))),

  update: (input: { id: string; name?: string; onboardingData?: OrganizationRowShape['onboardingData'] | null }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const patch: {
          name?: string
          onboardingData?: OrganizationRowShape['onboardingData'] | null
        } = {}

        if (input.name !== undefined) {
          patch.name = input.name
        }

        if (input.onboardingData !== undefined) {
          patch.onboardingData = input.onboardingData
        }

        if (Object.keys(patch).length === 0) {
          const rows = yield* db
            .select({
              id: organizations.id,
              name: organizations.name,
              billingEmail: organizations.billingEmail,
              onboardingData: organizations.onboardingData,
              stripeCustomerId: organizations.stripeCustomerId,
              stripeSubscriptionId: organizations.stripeSubscriptionId,
              stripePaymentMethodId: organizations.stripePaymentMethodId,
              stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
              creditsBalance: organizations.creditsBalance,
              reservedCredits: organizations.reservedCredits,
              autoRechargeEnabled: organizations.autoRechargeEnabled,
              autoRechargeThreshold: organizations.autoRechargeThreshold,
              autoRechargeAmount: organizations.autoRechargeAmount,
              isSubscribed: organizations.isSubscribed,
              subscriptionStatus: organizations.subscriptionStatus,
              subscriptionPlan: organizations.subscriptionPlan,
              subscriptionStartedAt: organizations.subscriptionStartedAt,
              subscriptionEndsAt: organizations.subscriptionEndsAt,
              subscriptionCurrentPeriodEnd: organizations.subscriptionCurrentPeriodEnd,
              createdAt: organizations.createdAt,
              updatedAt: organizations.updatedAt
            })
            .from(organizations)
            .where(eq(organizations.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeNullableOrganization(rows[0] ?? null)
        }

        const rows = yield* db
          .update(organizations)
          .set(patch)
          .where(eq(organizations.id, input.id))
          .returning()
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update organization', error))),

  remove: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(organizations)
          .where(eq(organizations.id, id))
          .returning()
          .execute()

        return yield* decodeNullableOrganization(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete organization', error))),

  isMember: (organizationId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ id: orgMembers.id })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check organization membership', error))),

  getMemberRole: (organizationId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: orgMembers.id,
            organizationId: orgMembers.organizationId,
            userId: orgMembers.userId,
            roleId: orgMembers.roleId,
            role: orgMembers.role,
            membershipType: orgMembers.membershipType,
            createdAt: orgMembers.createdAt,
            updatedAt: orgMembers.updatedAt
          })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return yield* decodeNullableOrgMember(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get member role', error))),

  getPrimaryMembershipForUser: (userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            id: orgMembers.id,
            organizationId: orgMembers.organizationId,
            userId: orgMembers.userId,
            roleId: orgMembers.roleId,
            role: orgMembers.role,
            membershipType: orgMembers.membershipType,
            createdAt: orgMembers.createdAt,
            updatedAt: orgMembers.updatedAt
          })
          .from(orgMembers)
          .where(eq(orgMembers.userId, userId))
          .orderBy(desc(orgMembers.createdAt), desc(orgMembers.id))
          .limit(1)
          .execute()

        return yield* decodeNullableOrgMember(rows[0] ?? null)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get primary org membership for user', error))),

  getMemberRolesForUser: (userId: string, organizationIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        if (organizationIds.length === 0) {
          return [] as const
        }

        const db = yield* DB
        const decodeOrgMemberRows = Schema.decodeUnknown(Schema.Array(orgMemberRowSchema))

        const rows = yield* db
          .select({
            id: orgMembers.id,
            organizationId: orgMembers.organizationId,
            userId: orgMembers.userId,
            roleId: orgMembers.roleId,
            role: orgMembers.role,
            membershipType: orgMembers.membershipType,
            createdAt: orgMembers.createdAt,
            updatedAt: orgMembers.updatedAt
          })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.userId, userId),
            inArray(orgMembers.organizationId, [...organizationIds])
          ))
          .execute()

        return yield* decodeOrgMemberRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('org member list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to get member roles for user', error))),

  countOwnedByUser: (userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ count: count() })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.userId, userId),
            eq(orgMembers.role, 'owner' as OrgMemberRole)
          ))
          .execute()

        return parseCountValue(rows[0]?.count)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to count organizations owned by user', error)))
}
