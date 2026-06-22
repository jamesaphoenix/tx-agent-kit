import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import type {
  EmailCampaignStatus,
  EmailCancelReason,
  EmailEnrollmentStatus,
  EmailSendStatus,
  EmailSourceSystem,
  EmailSuppressionReason
} from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { emailCampaignRowSchema } from '../effect-schemas/email-campaigns.js'
import { emailCampaignStepRowSchema } from '../effect-schemas/email-campaign-steps.js'
import { emailCampaignEnrollmentRowSchema } from '../effect-schemas/email-campaign-enrollments.js'
import { emailSendRowSchema } from '../effect-schemas/email-sends.js'
import { emailUnsubscribeRowSchema } from '../effect-schemas/email-unsubscribes.js'
import { toDbError } from '../errors.js'
import {
  emailCampaigns,
  emailCampaignSteps,
  emailCampaignEnrollments,
  emailSends,
  emailSuppressionList,
  emailUnsubscribes,
  users,
  type JsonObject
} from '../schema.js'
import { createNullableDecoder, parseCountValue } from './sql-helpers.js'

// ---------------------------------------------------------------------------
// Effect schema decoders — validate DB rows at runtime boundaries
// ---------------------------------------------------------------------------

const decodeCampaignRows = Schema.decodeUnknown(Schema.Array(emailCampaignRowSchema))
const decodeNullableCampaign = createNullableDecoder(emailCampaignRowSchema, 'email campaign row')
const decodeStepRows = Schema.decodeUnknown(Schema.Array(emailCampaignStepRowSchema))
const decodeNullableStep = createNullableDecoder(emailCampaignStepRowSchema, 'email campaign step row')
const decodeNullableEnrollment = createNullableDecoder(emailCampaignEnrollmentRowSchema, 'email campaign enrollment row')
const decodeNullableSend = createNullableDecoder(emailSendRowSchema, 'email send row')
const decodeNullableUnsubscribe = createNullableDecoder(emailUnsubscribeRowSchema, 'email unsubscribe row')

export {
  decodeCampaignRows,
  decodeNullableCampaign,
  decodeStepRows,
  decodeNullableStep,
  decodeNullableEnrollment,
  decodeNullableSend,
  decodeNullableUnsubscribe
}

// ---------------------------------------------------------------------------
// Row-to-domain mapping helpers
// ---------------------------------------------------------------------------

type CampaignRow = typeof emailCampaigns.$inferSelect
type CampaignStepRow = typeof emailCampaignSteps.$inferSelect
type EnrollmentRow = typeof emailCampaignEnrollments.$inferSelect
type EmailSendRow = typeof emailSends.$inferSelect
type UnsubscribeRow = typeof emailUnsubscribes.$inferSelect

const toCampaignRecord = (row: CampaignRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  campaignType: row.campaignType,
  status: row.status,
  triggerConfig: row.triggerConfig,
  audienceFilter: row.audienceFilter,
  fromName: row.fromName,
  replyTo: row.replyTo,
  slug: row.slug,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const toStepRecord = (row: CampaignStepRow) => ({
  id: row.id,
  campaignId: row.campaignId,
  stepOrder: row.stepOrder,
  subject: row.subject,
  templateId: row.templateId,
  templateData: row.templateData,
  delaySeconds: row.delaySeconds,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const toEnrollmentRecord = (row: EnrollmentRow) => ({
  id: row.id,
  campaignId: row.campaignId,
  userId: row.userId,
  status: row.status,
  currentStepOrder: row.currentStepOrder,
  nextStepAt: row.nextStepAt,
  pausedRemainingSecs: row.pausedRemainingSecs,
  sweepLeasedUntil: row.sweepLeasedUntil,
  cancelReason: row.cancelReason,
  temporalWorkflowId: row.temporalWorkflowId,
  triggerEventType: row.triggerEventType,
  triggerEventId: row.triggerEventId,
  enrolledAt: row.enrolledAt,
  completedAt: row.completedAt,
  cancelledAt: row.cancelledAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const toEmailSendRecord = (row: EmailSendRow) => ({
  id: row.id,
  enrollmentId: row.enrollmentId,
  stepId: row.stepId,
  campaignId: row.campaignId,
  userId: row.userId,
  toEmail: row.toEmail,
  status: row.status,
  resendMessageId: row.resendMessageId,
  sentAt: row.sentAt,
  deliveredAt: row.deliveredAt,
  openedAt: row.openedAt,
  clickedAt: row.clickedAt,
  bouncedAt: row.bouncedAt,
  complainedAt: row.complainedAt,
  failedReason: row.failedReason,
  metadata: row.metadata,
  createdAt: row.createdAt
})

const toUnsubscribeRecord = (row: UnsubscribeRow) => ({
  id: row.id,
  userId: row.userId,
  campaignId: row.campaignId,
  unsubscribedAt: row.unsubscribedAt,
  createdAt: row.createdAt
})

// ---------------------------------------------------------------------------
// campaignRepository
// ---------------------------------------------------------------------------

export const campaignRepository = {
  create: (input: {
    name: string
    description?: string | null
    campaignType: CampaignRow['campaignType']
    status?: EmailCampaignStatus
    triggerConfig?: unknown
    audienceFilter?: unknown
    fromName?: string | null
    replyTo?: string | null
    slug?: string | null
    createdBy?: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaigns)
          .values({
            name: input.name,
            description: input.description ?? null,
            campaignType: input.campaignType,
            ...(input.status !== undefined ? { status: input.status } : {}),
            triggerConfig: (input.triggerConfig ?? null) as JsonObject | null,
            audienceFilter: (input.audienceFilter ?? null) as JsonObject | null,
            fromName: input.fromName ?? null,
            replyTo: input.replyTo ?? null,
            slug: input.slug ?? null,
            createdBy: input.createdBy ?? null
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toCampaignRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create email campaign', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, id))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toCampaignRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch email campaign by id', error))),

  findBySlug: (slug: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.slug, slug))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toCampaignRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch email campaign by slug', error))),

  findMany: (filter: { status?: EmailCampaignStatus; campaignType?: CampaignRow['campaignType'] }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const predicates: SQL[] = []

        if (filter.status) {
          predicates.push(eq(emailCampaigns.status, filter.status))
        }
        if (filter.campaignType) {
          predicates.push(eq(emailCampaigns.campaignType, filter.campaignType))
        }

        const whereClause = predicates.length > 0 ? and(...predicates) : undefined

        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(whereClause)
          .orderBy(asc(emailCampaigns.createdAt))
          .execute()

        return rows.map(toCampaignRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list email campaigns', error))),

  updateById: (
    id: string,
    input: {
      name?: string
      description?: string | null
      triggerConfig?: unknown
      audienceFilter?: unknown
      fromName?: string | null
      replyTo?: string | null
      slug?: string | null
      status?: EmailCampaignStatus
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()` }

        if (input.name !== undefined) { patch.name = input.name }
        if (input.description !== undefined) { patch.description = input.description }
        if (input.triggerConfig !== undefined) { patch.triggerConfig = input.triggerConfig }
        if (input.audienceFilter !== undefined) { patch.audienceFilter = input.audienceFilter }
        if (input.fromName !== undefined) { patch.fromName = input.fromName }
        if (input.replyTo !== undefined) { patch.replyTo = input.replyTo }
        if (input.slug !== undefined) { patch.slug = input.slug }
        if (input.status !== undefined) { patch.status = input.status }

        const rows = yield* db
          .update(emailCampaigns)
          .set(patch)
          .where(eq(emailCampaigns.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toCampaignRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update email campaign', error))),

  findActiveByCampaignTrigger: (triggerConfig: unknown) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(
            and(
              eq(emailCampaigns.status, 'active'),
              sql`${emailCampaigns.triggerConfig} @> ${JSON.stringify(triggerConfig)}::jsonb`
            )
          )
          .execute()

        return rows.map(toCampaignRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find active campaigns by trigger', error)))
}

// ---------------------------------------------------------------------------
// enrollmentRepository
// ---------------------------------------------------------------------------

export const enrollmentRepository = {
  create: (input: {
    campaignId: string
    userId: string
    temporalWorkflowId?: string | null
    nextStepAt?: Date | null
    triggerEventType?: string | null
    triggerEventId?: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaignEnrollments)
          .values({
            campaignId: input.campaignId,
            userId: input.userId,
            temporalWorkflowId: input.temporalWorkflowId ?? null,
            nextStepAt: input.nextStepAt ?? null,
            triggerEventType: input.triggerEventType ?? null,
            triggerEventId: input.triggerEventId ?? null
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toEnrollmentRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create enrollment', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignEnrollments)
          .where(eq(emailCampaignEnrollments.id, id))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch enrollment by id', error))),

  findByCampaignAndUser: (campaignId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignEnrollments)
          .where(
            and(
              eq(emailCampaignEnrollments.campaignId, campaignId),
              eq(emailCampaignEnrollments.userId, userId)
            )
          )
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find enrollment by campaign and user', error))),

  findManyByCampaign: (campaignId: string, filter?: { status?: EmailEnrollmentStatus }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const predicates: SQL[] = [eq(emailCampaignEnrollments.campaignId, campaignId)]

        if (filter?.status) {
          predicates.push(eq(emailCampaignEnrollments.status, filter.status))
        }

        const rows = yield* db
          .select()
          .from(emailCampaignEnrollments)
          .where(and(...predicates))
          .orderBy(asc(emailCampaignEnrollments.enrolledAt))
          .execute()

        return rows.map(toEnrollmentRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list enrollments for campaign', error))),

  updateById: (
    id: string,
    input: {
      status?: EmailEnrollmentStatus
      currentStepOrder?: number | null
      nextStepAt?: Date | null
      pausedRemainingSecs?: number | null
      sweepLeasedUntil?: Date | null
      cancelReason?: EmailCancelReason | null
      temporalWorkflowId?: string | null
      triggerEventType?: string | null
      triggerEventId?: string | null
      enrolledAt?: Date | null
      completedAt?: Date | null
      cancelledAt?: Date | null
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()` }

        if (input.status !== undefined) { patch.status = input.status }
        if (input.currentStepOrder !== undefined) { patch.currentStepOrder = input.currentStepOrder }
        if (input.nextStepAt !== undefined) { patch.nextStepAt = input.nextStepAt }
        if (input.pausedRemainingSecs !== undefined) { patch.pausedRemainingSecs = input.pausedRemainingSecs }
        if (input.sweepLeasedUntil !== undefined) { patch.sweepLeasedUntil = input.sweepLeasedUntil }
        if (input.cancelReason !== undefined) { patch.cancelReason = input.cancelReason }
        if (input.temporalWorkflowId !== undefined) { patch.temporalWorkflowId = input.temporalWorkflowId }
        if (input.triggerEventType !== undefined) { patch.triggerEventType = input.triggerEventType }
        if (input.triggerEventId !== undefined) { patch.triggerEventId = input.triggerEventId }
        if (input.enrolledAt !== undefined) { patch.enrolledAt = input.enrolledAt }
        if (input.completedAt !== undefined) { patch.completedAt = input.completedAt }
        if (input.cancelledAt !== undefined) { patch.cancelledAt = input.cancelledAt }

        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set(patch)
          .where(eq(emailCampaignEnrollments.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update enrollment', error))),

  /**
   * Claim due enrollments for the sweep: active rows whose next_step_at is due
   * and not currently leased, locked with FOR UPDATE SKIP LOCKED and stamped
   * with a lease so a parallel/overrunning sweep cannot re-grab them.
   */
  claimDue: (now: Date, limit: number, leaseUntil: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        return yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const due = yield* trx
              .select({ id: emailCampaignEnrollments.id })
              .from(emailCampaignEnrollments)
              .where(
                and(
                  eq(emailCampaignEnrollments.status, 'active'),
                  // The campaign itself must still be active: pausing/archiving a
                  // campaign must stop sending to its in-flight enrollments, but
                  // the enrollment rows stay status='active' (a campaign pause is
                  // not an enrollment cancel), so the sweep would otherwise keep
                  // delivering. A subquery (not a join) keeps FOR UPDATE SKIP
                  // LOCKED locking only the enrollment rows. Resume re-includes them.
                  sql`${emailCampaignEnrollments.campaignId} IN (SELECT ${emailCampaigns.id} FROM ${emailCampaigns} WHERE ${emailCampaigns.status} = 'active')`,
                  lte(emailCampaignEnrollments.nextStepAt, now),
                  or(
                    isNull(emailCampaignEnrollments.sweepLeasedUntil),
                    lt(emailCampaignEnrollments.sweepLeasedUntil, now)
                  )
                )
              )
              .orderBy(asc(emailCampaignEnrollments.nextStepAt))
              .limit(limit)
              .for('update', { skipLocked: true })
              .execute()

            if (due.length === 0) {
              return [] as ReadonlyArray<ReturnType<typeof toEnrollmentRecord>>
            }

            const ids = due.map((row) => row.id)
            const rows = yield* trx
              .update(emailCampaignEnrollments)
              .set({ sweepLeasedUntil: leaseUntil, updatedAt: sql`now()` })
              .where(inArray(emailCampaignEnrollments.id, ids))
              .returning()
              .execute()

            return rows.map(toEnrollmentRecord)
          })
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to claim due enrollments', error))),

  /**
   * Status-guarded compare-and-set advance: only updates a still-active
   * enrollment, so a concurrent pause/cancel/unsubscribe wins (0 rows = the
   * enrollment was paused/cancelled and must not be resurrected). Always clears
   * the sweep lease.
   */
  advance: (
    id: string,
    input: {
      currentStepOrder?: number | null
      nextStepAt?: Date | null
      status?: EmailEnrollmentStatus
      completedAt?: Date | null
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()`, sweepLeasedUntil: null }
        if (input.currentStepOrder !== undefined) { patch.currentStepOrder = input.currentStepOrder }
        if (input.nextStepAt !== undefined) { patch.nextStepAt = input.nextStepAt }
        if (input.status !== undefined) { patch.status = input.status }
        if (input.completedAt !== undefined) { patch.completedAt = input.completedAt }

        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set(patch)
          .where(
            and(
              eq(emailCampaignEnrollments.id, id),
              eq(emailCampaignEnrollments.status, 'active')
            )
          )
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to advance enrollment', error))),

  cancelAllForCampaign: (campaignId: string, reason: EmailCancelReason) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set({
            status: 'cancelled' as EmailEnrollmentStatus,
            cancelReason: reason,
            cancelledAt: sql`now()`,
            updatedAt: sql`now()`
          })
          .where(
            and(
              eq(emailCampaignEnrollments.campaignId, campaignId),
              eq(emailCampaignEnrollments.status, 'active')
            )
          )
          .returning({ id: emailCampaignEnrollments.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to cancel all enrollments for campaign', error))),

  // Global-unsubscribe cleanup: cancel every active enrollment for a user across
  // all campaigns. The global suppression row already stops future sends (the
  // sweep's unsubscribe guard makes the reducer stop each enrollment), so this is
  // the eager, complete version of that so no enrollment lingers 'active'.
  cancelAllForUser: (userId: string, reason: EmailCancelReason) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set({
            status: 'cancelled' as EmailEnrollmentStatus,
            cancelReason: reason,
            cancelledAt: sql`now()`,
            updatedAt: sql`now()`
          })
          .where(
            and(
              eq(emailCampaignEnrollments.userId, userId),
              eq(emailCampaignEnrollments.status, 'active')
            )
          )
          .returning({ id: emailCampaignEnrollments.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to cancel all enrollments for user', error)))
}

// ---------------------------------------------------------------------------
// emailSendRepository
// ---------------------------------------------------------------------------

export const emailSendRepository = {
  create: (input: {
    enrollmentId?: string | null
    stepId: string
    campaignId: string
    userId: string
    toEmail: string
    resendMessageId?: string | null
    metadata?: unknown
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailSends)
          .values({
            enrollmentId: input.enrollmentId ?? null,
            stepId: input.stepId,
            campaignId: input.campaignId,
            userId: input.userId,
            toEmail: input.toEmail,
            resendMessageId: input.resendMessageId ?? null,
            metadata: (input.metadata ?? {}) as JsonObject
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toEmailSendRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create email send', error))),

  /**
   * Idempotent drip-send slot in one round-trip: insert the (enrollment, step)
   * send row if absent, else return the existing row untouched (its real status
   * included, so the caller can skip an already-sent step). Backed by the
   * partial-unique idx_email_sends_enrollment_step_unique, so two concurrent
   * render-and-send retries converge on a single row instead of racing two
   * inserts. Replaces the separate findByEnrollmentAndStep + create. Drip only:
   * enrollmentId is required; broadcast sends (null enrollment_id) use create().
   */
  upsertDripSend: (input: {
    enrollmentId: string
    stepId: string
    campaignId: string
    userId: string
    toEmail: string
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailSends)
          .values({
            enrollmentId: input.enrollmentId,
            stepId: input.stepId,
            campaignId: input.campaignId,
            userId: input.userId,
            toEmail: input.toEmail
          })
          .onConflictDoUpdate({
            target: [emailSends.enrollmentId, emailSends.stepId],
            targetWhere: sql`${emailSends.enrollmentId} IS NOT NULL`,
            // No-op self-assign: DO NOTHING returns no rows on conflict, so we
            // touch nothing-meaningful purely to make the existing row RETURNable.
            // The existing status/timestamps are deliberately left untouched.
            set: { enrollmentId: sql`${emailSends.enrollmentId}` }
          })
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to upsert drip send', error))),

  findByResendMessageId: (resendMessageId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailSends)
          .where(eq(emailSends.resendMessageId, resendMessageId))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find email send by resend message id', error))),

  findByEnrollmentAndStep: (enrollmentId: string, stepId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailSends)
          .where(
            and(
              eq(emailSends.enrollmentId, enrollmentId),
              eq(emailSends.stepId, stepId)
            )
          )
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find email send by enrollment and step', error))),

  updateStatus: (
    id: string,
    status: EmailSendStatus,
    timestamps: {
      sentAt?: Date | null
      deliveredAt?: Date | null
      openedAt?: Date | null
      clickedAt?: Date | null
      bouncedAt?: Date | null
      complainedAt?: Date | null
      failedReason?: string | null
      resendMessageId?: string | null
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { status }

        if (timestamps.sentAt !== undefined) { patch.sentAt = timestamps.sentAt }
        if (timestamps.deliveredAt !== undefined) { patch.deliveredAt = timestamps.deliveredAt }
        if (timestamps.openedAt !== undefined) { patch.openedAt = timestamps.openedAt }
        if (timestamps.clickedAt !== undefined) { patch.clickedAt = timestamps.clickedAt }
        if (timestamps.bouncedAt !== undefined) { patch.bouncedAt = timestamps.bouncedAt }
        if (timestamps.complainedAt !== undefined) { patch.complainedAt = timestamps.complainedAt }
        if (timestamps.failedReason !== undefined) { patch.failedReason = timestamps.failedReason }
        if (timestamps.resendMessageId !== undefined) { patch.resendMessageId = timestamps.resendMessageId }

        const rows = yield* db
          .update(emailSends)
          .set(patch)
          .where(eq(emailSends.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update email send status', error))),

  aggregateByCampaign: (campaignId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const enrollmentRows = yield* db
          .select({
            total: count(),
            active: sql<number>`count(*) filter (where ${emailCampaignEnrollments.status} = 'active')`,
            completed: sql<number>`count(*) filter (where ${emailCampaignEnrollments.status} = 'completed')`,
            cancelled: sql<number>`count(*) filter (where ${emailCampaignEnrollments.status} = 'cancelled')`
          })
          .from(emailCampaignEnrollments)
          .where(eq(emailCampaignEnrollments.campaignId, campaignId))
          .execute()

        const sendRows = yield* db
          .select({
            total: count(),
            delivered: sql<number>`count(*) filter (where ${emailSends.status} = 'delivered')`,
            opened: sql<number>`count(*) filter (where ${emailSends.status} = 'opened')`,
            clicked: sql<number>`count(*) filter (where ${emailSends.status} = 'clicked')`,
            bounced: sql<number>`count(*) filter (where ${emailSends.status} = 'bounced')`,
            complained: sql<number>`count(*) filter (where ${emailSends.status} = 'complained')`,
            failed: sql<number>`count(*) filter (where ${emailSends.status} = 'failed')`
          })
          .from(emailSends)
          .where(eq(emailSends.campaignId, campaignId))
          .execute()

        const enrollment = enrollmentRows[0]
        const send = sendRows[0]

        return {
          campaignId,
          totalEnrollments: parseCountValue(enrollment?.total),
          activeEnrollments: parseCountValue(enrollment?.active),
          completedEnrollments: parseCountValue(enrollment?.completed),
          cancelledEnrollments: parseCountValue(enrollment?.cancelled),
          totalSends: parseCountValue(send?.total),
          delivered: parseCountValue(send?.delivered),
          opened: parseCountValue(send?.opened),
          clicked: parseCountValue(send?.clicked),
          bounced: parseCountValue(send?.bounced),
          complained: parseCountValue(send?.complained),
          failed: parseCountValue(send?.failed)
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to aggregate campaign analytics', error))),

  aggregateByStep: (campaignId: string, stepId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const rows = yield* db
          .select({
            total: count(),
            delivered: sql<number>`count(*) filter (where ${emailSends.status} = 'delivered')`,
            opened: sql<number>`count(*) filter (where ${emailSends.status} = 'opened')`,
            clicked: sql<number>`count(*) filter (where ${emailSends.status} = 'clicked')`,
            bounced: sql<number>`count(*) filter (where ${emailSends.status} = 'bounced')`,
            complained: sql<number>`count(*) filter (where ${emailSends.status} = 'complained')`,
            failed: sql<number>`count(*) filter (where ${emailSends.status} = 'failed')`
          })
          .from(emailSends)
          .where(
            and(
              eq(emailSends.campaignId, campaignId),
              eq(emailSends.stepId, stepId)
            )
          )
          .execute()

        const row = rows[0]

        return {
          stepId,
          campaignId,
          totalSends: parseCountValue(row?.total),
          delivered: parseCountValue(row?.delivered),
          opened: parseCountValue(row?.opened),
          clicked: parseCountValue(row?.clicked),
          bounced: parseCountValue(row?.bounced),
          complained: parseCountValue(row?.complained),
          failed: parseCountValue(row?.failed)
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to aggregate step analytics', error))),

  pruneOlderThan: (cutoffDate: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(emailSends)
          .where(
            and(
              lt(emailSends.createdAt, cutoffDate),
              inArray(emailSends.status, ['delivered', 'opened', 'clicked'])
            )
          )
          .returning({ id: emailSends.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to prune old email sends', error))),

  /**
   * Delete every send row for an enrollment. Used when a terminal enrollment is
   * re-enrolled in place (the (campaign,user) row id is reused): the prior
   * cycle's `sent` rows would otherwise satisfy the per-(enrollment,step)
   * idempotency check in `renderAndSendEmail` and silently suppress the new
   * cycle's emails. email_sends has a retention policy (it is not a financial
   * audit trail), so clearing a re-enrolled cycle's rows is safe.
   */
  deleteByEnrollment: (enrollmentId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(emailSends)
          .where(eq(emailSends.enrollmentId, enrollmentId))
          .returning({ id: emailSends.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete email sends for enrollment', error))),

  /**
   * True when the user has clicked the CTA of any prior feedback-ask email
   * (a send whose step's templateId is one of `feedbackTemplateIds` and whose
   * row has a non-null `clicked_at`). Backs the `has_not_left_feedback` audience
   * predicate: "left feedback" = clicked a feedback email's CTA, so the engine
   * suppresses re-asking. Joins email_sends -> email_campaign_steps by step id.
   */
  hasClickedFeedbackEmail: (userId: string, feedbackTemplateIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (feedbackTemplateIds.length === 0) {
          return false
        }
        const rows = yield* db
          .select({ id: emailSends.id })
          .from(emailSends)
          .innerJoin(emailCampaignSteps, eq(emailCampaignSteps.id, emailSends.stepId))
          .where(
            and(
              eq(emailSends.userId, userId),
              sql`${emailSends.clickedAt} IS NOT NULL`,
              inArray(emailCampaignSteps.templateId, [...feedbackTemplateIds])
            )
          )
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check feedback-email click', error)))
}

// ---------------------------------------------------------------------------
// campaignStepRepository
// ---------------------------------------------------------------------------

export const campaignStepRepository = {
  create: (input: {
    campaignId: string
    stepOrder: number
    subject: string
    templateId: string
    templateData?: unknown
    delaySeconds?: number
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaignSteps)
          .values({
            campaignId: input.campaignId,
            stepOrder: input.stepOrder,
            subject: input.subject,
            templateId: input.templateId,
            templateData: (input.templateData ?? {}) as JsonObject,
            delaySeconds: input.delaySeconds ?? 0
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toStepRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create campaign step', error))),

  findByCampaign: (campaignId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(eq(emailCampaignSteps.campaignId, campaignId))
          .orderBy(asc(emailCampaignSteps.stepOrder))
          .execute()

        return rows.map(toStepRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list campaign steps', error))),

  /**
   * Batch the steps for several campaigns in one query (ordered by campaign then
   * step order). The caller groups by `campaignId`; within a campaign the steps
   * stay in step order. Used by the drip sweep to avoid one query per enrollment.
   */
  findByCampaigns: (campaignIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (campaignIds.length === 0) {
          return []
        }
        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(inArray(emailCampaignSteps.campaignId, [...campaignIds]))
          .orderBy(asc(emailCampaignSteps.campaignId), asc(emailCampaignSteps.stepOrder))
          .execute()

        return rows.map(toStepRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list campaign steps for campaigns', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(eq(emailCampaignSteps.id, id))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toStepRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch campaign step by id', error))),

  updateById: (
    id: string,
    input: {
      subject?: string
      templateId?: string
      templateData?: unknown
      delaySeconds?: number
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()` }

        if (input.subject !== undefined) { patch.subject = input.subject }
        if (input.templateId !== undefined) { patch.templateId = input.templateId }
        if (input.templateData !== undefined) { patch.templateData = input.templateData }
        if (input.delaySeconds !== undefined) { patch.delaySeconds = input.delaySeconds }

        const rows = yield* db
          .update(emailCampaignSteps)
          .set(patch)
          .where(eq(emailCampaignSteps.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toStepRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update campaign step', error))),

  deleteById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        yield* db
          .delete(emailCampaignSteps)
          .where(eq(emailCampaignSteps.id, id))
          .execute()

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete campaign step', error))),

  reorder: (campaignId: string, stepIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        if (stepIds.length > 0) {
          // Bulk UPDATE using a VALUES list instead of N individual updates
          const valuesList = stepIds
            .map((id, i) => sql`(${id}::uuid, ${i + 1})`)
            .reduce((acc, v) => sql`${acc}, ${v}`)

          yield* db.execute(
            sql`UPDATE ${emailCampaignSteps}
                SET step_order = v.new_order, updated_at = now()
                FROM (VALUES ${valuesList}) AS v(id, new_order)
                WHERE ${emailCampaignSteps.id} = v.id
                  AND ${emailCampaignSteps.campaignId} = ${campaignId}`
          )
        }

        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(eq(emailCampaignSteps.campaignId, campaignId))
          .orderBy(asc(emailCampaignSteps.stepOrder))
          .execute()

        return rows.map(toStepRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to reorder campaign steps', error)))
}

// ---------------------------------------------------------------------------
// unsubscribeRepository
// ---------------------------------------------------------------------------

export const unsubscribeRepository = {
  isUnsubscribed: (userId: string, campaignId: string | null) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const whereClause = campaignId
          ? and(
              eq(emailUnsubscribes.userId, userId),
              eq(emailUnsubscribes.campaignId, campaignId)
            )
          : and(
              eq(emailUnsubscribes.userId, userId),
              isNull(emailUnsubscribes.campaignId)
            )

        const rows = yield* db
          .select({ id: emailUnsubscribes.id })
          .from(emailUnsubscribes)
          .where(whereClause)
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check unsubscribe status', error))),

  /**
   * One-query check: is the user unsubscribed from this campaign specifically OR
   * globally (campaignId null)? Collapses the two `isUnsubscribed` round-trips the
   * enroll/send seams previously made into a single query.
   */
  isUnsubscribedFromAny: (userId: string, campaignId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ id: emailUnsubscribes.id })
          .from(emailUnsubscribes)
          .where(
            and(
              eq(emailUnsubscribes.userId, userId),
              or(eq(emailUnsubscribes.campaignId, campaignId), isNull(emailUnsubscribes.campaignId))
            )
          )
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check unsubscribe status', error))),

  /**
   * Batch unsubscribe lookup for several users in one query. Returns every
   * (userId, campaignId) unsubscribe row (campaignId null = global). The caller
   * groups by userId. Used by the drip sweep.
   */
  findForUsers: (userIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (userIds.length === 0) {
          return []
        }
        const rows = yield* db
          .select({ userId: emailUnsubscribes.userId, campaignId: emailUnsubscribes.campaignId })
          .from(emailUnsubscribes)
          .where(inArray(emailUnsubscribes.userId, [...userIds]))
          .execute()

        return rows
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch unsubscribes for users', error))),

  unsubscribe: (input: { userId: string; campaignId: string | null }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailUnsubscribes)
          .values({
            userId: input.userId,
            campaignId: input.campaignId
          })
          .onConflictDoNothing()
          .returning()
          .execute()

        const row = rows[0]

        if (!row) {
          // Already unsubscribed — fetch existing record
          const whereClause = input.campaignId
            ? and(
                eq(emailUnsubscribes.userId, input.userId),
                eq(emailUnsubscribes.campaignId, input.campaignId)
              )
            : and(
                eq(emailUnsubscribes.userId, input.userId),
                isNull(emailUnsubscribes.campaignId)
              )

          const existing = yield* db
            .select()
            .from(emailUnsubscribes)
            .where(whereClause)
            .limit(1)
            .execute()

          const existingRow = existing[0]
          if (!existingRow) {
            return yield* Effect.fail(new Error('Unsubscribe record not found after conflict'))
          }

          return toUnsubscribeRecord(existingRow)
        }

        return toUnsubscribeRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to unsubscribe', error)))
}

// ---------------------------------------------------------------------------
// suppressionRepository
// ---------------------------------------------------------------------------

export const suppressionRepository = {
  isSuppressed: (email: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ id: emailSuppressionList.id })
          .from(emailSuppressionList)
          .where(
            and(
              eq(sql`lower(${emailSuppressionList.email})`, sql`lower(${email})`),
              isNull(emailSuppressionList.liftedAt)
            )
          )
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check email suppression', error))),

  /**
   * Add an address to the suppression list (e.g. after a hard bounce or spam
   * complaint webhook), so the drip sweep + enroll stop emailing it. Idempotent:
   * a second suppression for an already-active address is a no-op via the partial
   * unique index on lower(email) WHERE lifted_at IS NULL.
   */
  suppress: (input: {
    email: string
    reason: EmailSuppressionReason
    sourceSystem: EmailSourceSystem
    sourceId: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        yield* db
          .insert(emailSuppressionList)
          .values({
            email: input.email,
            reason: input.reason,
            sourceSystem: input.sourceSystem,
            sourceId: input.sourceId
          })
          .onConflictDoNothing()
          .execute()
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to add email to suppression list', error))),

  /**
   * Batch suppression check: returns the lowercased subset of `emails` that are
   * actively suppressed (one query). Used by the drip sweep.
   */
  findSuppressed: (emails: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (emails.length === 0) {
          return []
        }
        const lowered = emails.map((email) => email.toLowerCase())
        const rows = yield* db
          .select({ email: emailSuppressionList.email })
          .from(emailSuppressionList)
          .where(
            and(
              inArray(sql`lower(${emailSuppressionList.email})`, lowered),
              isNull(emailSuppressionList.liftedAt)
            )
          )
          .execute()

        return rows.map((row) => row.email.toLowerCase())
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch email suppression list', error)))
}

// ---------------------------------------------------------------------------
// audienceRepository
// ---------------------------------------------------------------------------

export const audienceRepository = {
  resolveAllUsers: () =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            userId: users.id,
            email: users.email,
            name: users.name
          })
          .from(users)
          .execute()

        return rows
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to resolve audience users', error))),

  updateSendResendMessageId: (sendId: string, resendMessageId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        yield* db
          .update(emailSends)
          .set({ resendMessageId })
          .where(eq(emailSends.id, sendId))
          .execute()
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update email send resend message id', error)))
}
