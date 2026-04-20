import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL
} from 'drizzle-orm'
import { type DomainEventAggregateType, type DomainEventType, type OrgMemberRole } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { buildCursorCondition, buildCursorPage } from '../pagination.js'
import { organizationRowSchema, type OrganizationRowShape } from '../effect-schemas/organizations.js'
import { orgMemberRowSchema, orgMemberWithUserRowSchema, type OrgMemberWithUserRowShape } from '../effect-schemas/org-members.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { organizations, orgMembers, teams, teamMediaAssets, users, type JsonObject } from '../schema.js'
import { insertDomainEventInTransaction } from './domain-events.js'
import type { ListParams } from './list-params.js'
import { withDb, decodeFirst } from './repo-helpers.js'
import { createOptionalDecoder, parseCountValue } from './sql-helpers.js'

const decodeOrganizationRows = Schema.decodeUnknown(Schema.Array(organizationRowSchema))
const decodeOrg = createOptionalDecoder(organizationRowSchema, 'organization row')
const decodeMember = createOptionalDecoder(orgMemberRowSchema, 'org member row')

const organizationSelectColumns = {
  id: organizations.id,
  name: organizations.name,
  ownerUserId: organizations.ownerUserId,
  billingEmail: organizations.billingEmail,
  onboardingData: organizations.onboardingData,
  stripeCustomerId: organizations.stripeCustomerId,
  stripeSubscriptionId: organizations.stripeSubscriptionId,
  stripePaymentMethodId: organizations.stripePaymentMethodId,
  stripeMeteredSubscriptionItemId: organizations.stripeMeteredSubscriptionItemId,
  usageCap: organizations.usageCap,
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
  paymentGracePeriodEndsAt: organizations.paymentGracePeriodEndsAt,
  suspendedAt: organizations.suspendedAt,
  welcomeCreditGrantedAt: organizations.welcomeCreditGrantedAt,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt
} as const

const orgMemberSelectColumns = {
  id: orgMembers.id,
  organizationId: orgMembers.organizationId,
  userId: orgMembers.userId,
  roleId: orgMembers.roleId,
  role: orgMembers.role,
  membershipType: orgMembers.membershipType,
  disabledAt: orgMembers.disabledAt,
  createdAt: orgMembers.createdAt,
  updatedAt: orgMembers.updatedAt
} as const

const buildListWhere = (userId: string): SQL =>
  eq(orgMembers.userId, userId)

export const organizationsRepository = {
  list: (userId: string, params: ListParams) =>
    withDb('Failed to list organizations for user', (db) =>
      Effect.gen(function* () {
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
                const cursorWhere = buildCursorCondition(cursor, sortOrder, organizations.name, cursor?.sortValue ?? '', organizations.id)

                const rows = yield* db
                  .select(organizationSelectColumns)
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

              const cursorWhere = buildCursorCondition(cursor, sortOrder, organizations.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), organizations.id)

              const rows = yield* db
                .select(organizationSelectColumns)
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
    ),

  listForUser: (userId: string, params: ListParams) =>
    organizationsRepository.list(userId, params),

  getById: (id: string) =>
    withDb('Failed to fetch organization by id', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(organizationSelectColumns)
          .from(organizations)
          .where(eq(organizations.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  getManyByIdsForUser: (userId: string, ids: ReadonlyArray<string>) =>
    withDb('Failed to fetch organizations by ids for user', (db) =>
      Effect.gen(function* () {
        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* db
          .select(organizationSelectColumns)
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
    ),

  create: (input: { name: string; ownerUserId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const orgRows = yield* trx
              .insert(organizations)
              .values({ name: input.name, ownerUserId: input.ownerUserId })
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
                role: 'admin'
              })
              .execute()

            return org
          })
        )

        return yield* decodeOrg(result)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create organization', error))),

  createWithEvent: (input: {
    name: string
    ownerUserId: string
    event: {
      eventType: DomainEventType
      aggregateType: DomainEventAggregateType
      payload: JsonObject
      correlationId?: string | null
    }
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const orgRows = yield* trx
              .insert(organizations)
              .values({ name: input.name, ownerUserId: input.ownerUserId })
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
                role: 'admin'
              })
              .execute()

            yield* insertDomainEventInTransaction(trx, {
              eventType: input.event.eventType,
              aggregateType: input.event.aggregateType,
              aggregateId: org.id,
              payload: input.event.payload,
              correlationId: input.event.correlationId ?? null
            })

            return org
          })
        )

        return yield* decodeOrg(result)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create organization with event', error))),

  update: (input: { id: string; name?: string; onboardingData?: OrganizationRowShape['onboardingData'] | null }) =>
    withDb('Failed to update organization', (db) =>
      Effect.gen(function* () {
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
            .select(organizationSelectColumns)
            .from(organizations)
            .where(eq(organizations.id, input.id))
            .limit(1)
            .execute()

          return yield* decodeFirst(rows, decodeOrg)
        }

        const rows = yield* db
          .update(organizations)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(organizations.id, input.id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  remove: (id: string) =>
    withDb('Failed to delete organization', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .delete(organizations)
          .where(eq(organizations.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeOrg)
      })
    ),

  removeWithEvent: (input: {
    id: string
    event: {
      eventType: DomainEventType
      aggregateType: DomainEventAggregateType
      payload: JsonObject
      correlationId?: string | null
    }
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // Collect R2 storage paths from ALL teams' assets BEFORE cascade delete
            const assetRows = yield* trx
              .select({
                storagePath: teamMediaAssets.storagePath,
                thumbnailPath: teamMediaAssets.thumbnailPath
              })
              .from(teamMediaAssets)
              .innerJoin(teams, eq(teamMediaAssets.teamId, teams.id))
              .where(eq(teams.organizationId, input.id))
              .execute()

            const storagePaths = assetRows.flatMap((a) =>
              [a.storagePath, ...(a.thumbnailPath ? [a.thumbnailPath] : [])]
            )

            yield* insertDomainEventInTransaction(trx, {
              eventType: input.event.eventType,
              aggregateType: input.event.aggregateType,
              aggregateId: input.id,
              payload: { ...input.event.payload, storagePaths },
              correlationId: input.event.correlationId ?? null
            })

            yield* trx
              .delete(organizations)
              .where(eq(organizations.id, input.id))
              .execute()
          })
        )

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete organization with event', error))),

  isMember: (organizationId: string, userId: string) =>
    withDb('Failed to check organization membership', (db) =>
      Effect.gen(function* () {
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
    ),

  getMemberRole: (organizationId: string, userId: string) =>
    withDb('Failed to get member role', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.userId, userId)
          ))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  getPrimaryMembershipForUser: (userId: string) =>
    withDb('Failed to get primary org membership for user', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated (user-scoped lookup, not tenant-scoped)
        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(eq(orgMembers.userId, userId))
          .orderBy(desc(orgMembers.createdAt), desc(orgMembers.id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  getMemberRolesForUser: (userId: string, organizationIds: ReadonlyArray<string>) =>
    withDb('Failed to get member roles for user', (db) =>
      Effect.gen(function* () {
        if (organizationIds.length === 0) {
          return [] as const
        }

        const decodeOrgMemberRows = Schema.decodeUnknown(Schema.Array(orgMemberRowSchema))

        const rows = yield* db
          .select(orgMemberSelectColumns)
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
    ),

  countOwnedByUser: (userId: string) =>
    withDb('Failed to count organizations owned by user', (db) =>
      Effect.gen(function* () {
        // Ownership is tracked by organizations.owner_user_id, not by role
        const rows = yield* db
          .select({ count: count() })
          .from(organizations)
          .where(eq(organizations.ownerUserId, userId))
          .execute()

        return parseCountValue(rows[0]?.count)
      })
    ),

  countActiveAdmins: (organizationId: string) =>
    withDb('Failed to count active admins', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ count: count() })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.organizationId, organizationId),
            eq(orgMembers.role, 'admin' as OrgMemberRole),
            isNull(orgMembers.disabledAt)
          ))
          .execute()

        return parseCountValue(rows[0]?.count)
      })
    ),

  disableMember: (id: string) =>
    withDb('Failed to disable org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(orgMembers)
          .set({ disabledAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(orgMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  enableMember: (id: string) =>
    withDb('Failed to enable org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(orgMembers)
          .set({ disabledAt: null, updatedAt: sql`now()` })
          .where(eq(orgMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  listMembers: (organizationId: string, params: ListParams) =>
    withDb('Failed to list org members', (db) =>
      Effect.gen(function* () {
        const sortOrder = params.sortOrder
        const baseWhere: SQL = eq(orgMembers.organizationId, organizationId)
        const decodeOrgMemberWithUserRows = Schema.decodeUnknown(Schema.Array(orgMemberWithUserRowSchema))

        const page = yield* buildCursorPage<OrgMemberWithUserRowShape>({
          cursor: params.cursor,
          limit: params.limit,
          sortBy: 'createdAt',
          sortOrder,
          runCount: () =>
            Effect.gen(function* () {
              const rows = yield* db
                .select({ count: count() })
                .from(orgMembers)
                .where(baseWhere)
                .execute()

              return parseCountValue(rows[0]?.count)
            }).pipe(Effect.mapError((error) => toDbError('Failed to count org members', error))),
          runPage: (cursor, limitPlusOne) =>
            Effect.gen(function* () {
              const cursorWhere = buildCursorCondition(cursor, sortOrder, orgMembers.createdAt, cursor ? new Date(cursor.sortValue) : new Date(), orgMembers.id)

              const rows = yield* db
                .select({
                  id: orgMembers.id,
                  organizationId: orgMembers.organizationId,
                  userId: orgMembers.userId,
                  roleId: orgMembers.roleId,
                  role: orgMembers.role,
                  membershipType: orgMembers.membershipType,
                  disabledAt: orgMembers.disabledAt,
                  userName: users.name,
                  userEmail: users.email,
                  createdAt: orgMembers.createdAt,
                  updatedAt: orgMembers.updatedAt
                })
                .from(orgMembers)
                .leftJoin(users, eq(orgMembers.userId, users.id))
                .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
                .orderBy(
                  sortOrder === 'asc' ? asc(orgMembers.createdAt) : desc(orgMembers.createdAt),
                  sortOrder === 'asc' ? asc(orgMembers.id) : desc(orgMembers.id)
                )
                .limit(limitPlusOne)
                .execute()

              return yield* decodeOrgMemberWithUserRows(rows).pipe(
                Effect.mapError((error) => dbDecodeFailed('org member list decode failed', error))
              )
            }).pipe(Effect.mapError((error) => toDbError('Failed to list org members', error))),
          getCursorId: (row) => row.id,
          getCursorSortValue: (row) => row.createdAt.toISOString()
        })

        return {
          data: page.data,
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    ),

  getMemberById: (id: string) =>
    withDb('Failed to get org member by id', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .select(orgMemberSelectColumns)
          .from(orgMembers)
          .where(eq(orgMembers.id, id))
          .limit(1)
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  addMember: (input: { organizationId: string; userId: string; role: OrgMemberRole }) =>
    withDb('Failed to add org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .insert(orgMembers)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role
          })
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  updateMemberRole: (id: string, role: OrgMemberRole) =>
    withDb('Failed to update org member role', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        const rows = yield* db
          .update(orgMembers)
          .set({ role, updatedAt: sql`now()` })
          .where(eq(orgMembers.id, id))
          .returning()
          .execute()

        return yield* decodeFirst(rows, decodeMember)
      })
    ),

  removeMember: (id: string) =>
    withDb('Failed to remove org member', (db) =>
      Effect.gen(function* () {
        // tenant-scope: service-validated
        yield* db
          .delete(orgMembers)
          .where(eq(orgMembers.id, id))
          .execute()

        return { deleted: true as const }
      })
    ),

  transferOwnership: (input: { organizationId: string; fromUserId: string; toUserId: string }) =>
    withDb('Failed to transfer organization ownership', (db) =>
      Effect.gen(function* () {
        // Ownership is tracked by organizations.owner_user_id.
        // Both old and new owner keep their 'admin' role — only the owner_user_id pointer changes.
        yield* db
          .update(organizations)
          .set({ ownerUserId: input.toUserId, updatedAt: sql`now()` })
          .where(eq(organizations.id, input.organizationId))
          .execute()

        return { transferred: true as const }
      })
    ),

  /**
   * Set the payment grace period end timestamp for an organization.
   *
   * Called by the billing outbox consumer when handling a
   * `billing.payment_failed` event. The grace period gives the org time to
   * update their payment method before operations are blocked.
   *
   * @spec INV-BILLING-010 — billing event consumers are idempotent; setting
   * the same timestamp on retry is a no-op in effect.
   */
  setPaymentGracePeriod: (organizationId: string, endsAt: Date) =>
    withDb('Failed to set payment grace period', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(organizations)
          .set({ paymentGracePeriodEndsAt: endsAt, updatedAt: sql`now()` })
          .where(eq(organizations.id, organizationId))
          .execute()

        return { updated: true as const }
      })
    ),

  /**
   * Set `suspended_at = now()` for an organization. Called when usage cap is
   * exceeded or when a Stripe charge is disputed (freezeCreditBalance). The
   * column being non-null is the canonical "block all credit-consuming
   * operations" signal — readers in the API layer guard on it.
   *
   * Idempotency: if the row is already suspended we do not overwrite the
   * timestamp (preserves the original suspension instant for audit).
   *
   * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
   * @spec INV-BILLING-010 — billing event consumers are idempotent.
   */
  setSuspended: (organizationId: string) =>
    withDb('Failed to suspend organization', (db) =>
      Effect.gen(function* () {
        const result = yield* db
          .update(organizations)
          .set({ suspendedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(organizations.id, organizationId), isNull(organizations.suspendedAt)))
          .returning({ id: organizations.id })
          .execute()

        return { suspended: result.length > 0 }
      })
    ),

  /**
   * Clear `suspended_at` (set to NULL) for an organization. Called by the
   * credit-positive re-evaluation consumer after a top-up, recharge, or
   * dispute-resolved-won restores the available balance to positive.
   *
   * Idempotency: a no-op when the org is not suspended.
   */
  clearSuspended: (organizationId: string) =>
    withDb('Failed to unsuspend organization', (db) =>
      Effect.gen(function* () {
        const result = yield* db
          .update(organizations)
          .set({ suspendedAt: null, updatedAt: sql`now()` })
          .where(and(eq(organizations.id, organizationId), sql`${organizations.suspendedAt} IS NOT NULL`))
          .returning({ id: organizations.id })
          .execute()

        return { cleared: result.length > 0 }
      })
    ),

  /**
   * Atomic variant used by the credit-positive re-evaluation path: only
   * clears `suspended_at` if the org is currently suspended AND the
   * current available balance (creditsBalance − reservedCredits) is
   * strictly positive. Moving the balance predicate into the UPDATE
   * WHERE closes a TOCTOU where a concurrent finalize or
   * charge.refunded between a caller's read and write could drop
   * available below zero before the clear committed, leaving the org
   * unsuspended with negative available. The old unconditional
   * `clearSuspended` remains for pure concurrency stress tests that
   * don't care about balance.
   *
   * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
   */
  clearSuspendedIfPositiveBalance: (organizationId: string) =>
    withDb('Failed to conditionally unsuspend organization', (db) =>
      Effect.gen(function* () {
        const result = yield* db
          .update(organizations)
          .set({ suspendedAt: null, updatedAt: sql`now()` })
          .where(and(
            eq(organizations.id, organizationId),
            sql`${organizations.suspendedAt} IS NOT NULL`,
            sql`(${organizations.creditsBalance} - ${organizations.reservedCredits}) > 0`
          ))
          .returning({ id: organizations.id })
          .execute()

        return { cleared: result.length > 0 }
      })
    )
}
