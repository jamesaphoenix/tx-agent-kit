import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lt,
  sql,
  type SQL
} from 'drizzle-orm'
import type {
  EmailCampaignStatus,
  EmailCancelReason,
  EmailEnrollmentStatus,
  EmailSendStatus
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
  cancelReason: row.cancelReason,
  temporalWorkflowId: row.temporalWorkflowId,
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
    triggerConfig?: unknown
    audienceFilter?: unknown
    fromName?: string | null
    replyTo?: string | null
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
            triggerConfig: (input.triggerConfig ?? null) as JsonObject | null,
            audienceFilter: (input.audienceFilter ?? null) as JsonObject | null,
            fromName: input.fromName ?? null,
            replyTo: input.replyTo ?? null,
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
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaignEnrollments)
          .values({
            campaignId: input.campaignId,
            userId: input.userId,
            temporalWorkflowId: input.temporalWorkflowId ?? null
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
      cancelReason?: EmailCancelReason | null
      temporalWorkflowId?: string | null
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
        if (input.cancelReason !== undefined) { patch.cancelReason = input.cancelReason }
        if (input.temporalWorkflowId !== undefined) { patch.temporalWorkflowId = input.temporalWorkflowId }
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to cancel all enrollments for campaign', error)))
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to prune old email sends', error)))
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
    ).pipe(Effect.mapError((error) => toDbError('Failed to check email suppression', error)))
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
