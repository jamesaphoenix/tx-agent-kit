import { Context, Effect, Layer } from 'effect'
import { badRequest, conflict, internalError, notFound, type CoreError } from '../../../errors.js'
import type {
  CampaignAnalytics,
  CampaignRecord,
  CampaignStepRecord,
  CreateCampaignInput,
  EmailSendRecord,
  EmailSendStatus,
  EmailSendTimestamps,
  EnrollmentRecord,
  StepAnalytics,
  UpdateCampaignInput
} from '../domain/email-campaign-domain.js'
import {
  canActivateCampaign,
  canAdvanceEmailSendStatus,
  canModifySteps,
  isValidTransition
} from '../domain/email-campaign-rules.js'
import { ClockPort } from '../../../ports/clock-port.js'
import {
  CampaignStepStorePort,
  CampaignStorePort,
  EmailSendStorePort,
  EnrollmentStorePort,
  UnsubscribeStorePort
} from '../ports/email-campaign-ports.js'

const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)

export class EmailCampaignService extends Context.Tag('EmailCampaignService')<
  EmailCampaignService,
  {
    createCampaign: (
      input: CreateCampaignInput
    ) => Effect.Effect<CampaignRecord, CoreError, CampaignStorePort>

    updateCampaign: (
      id: string,
      input: UpdateCampaignInput
    ) => Effect.Effect<CampaignRecord, CoreError, CampaignStorePort>

    activateCampaign: (
      id: string
    ) => Effect.Effect<CampaignRecord, CoreError, CampaignStorePort | CampaignStepStorePort>

    pauseCampaign: (
      id: string
    ) => Effect.Effect<CampaignRecord, CoreError, CampaignStorePort>

    resumeCampaign: (
      id: string
    ) => Effect.Effect<CampaignRecord, CoreError, CampaignStorePort>

    archiveCampaign: (
      id: string
    ) => Effect.Effect<CampaignRecord, CoreError, CampaignStorePort | EnrollmentStorePort>

    addStep: (
      campaignId: string,
      input: {
        subject: string
        templateId: string
        templateData?: unknown
        delaySeconds?: number
      }
    ) => Effect.Effect<CampaignStepRecord, CoreError, CampaignStorePort | CampaignStepStorePort>

    updateStep: (
      campaignId: string,
      stepId: string,
      input: {
        subject?: string
        templateId?: string
        templateData?: unknown
        delaySeconds?: number
      }
    ) => Effect.Effect<CampaignStepRecord, CoreError, CampaignStorePort | CampaignStepStorePort>

    removeStep: (
      campaignId: string,
      stepId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, CampaignStorePort | CampaignStepStorePort>

    enrollUser: (
      campaignId: string,
      userId: string
    ) => Effect.Effect<
      EnrollmentRecord,
      CoreError,
      CampaignStorePort | EnrollmentStorePort | UnsubscribeStorePort | ClockPort
    >

    cancelEnrollment: (
      enrollmentId: string,
      reason: string
    ) => Effect.Effect<EnrollmentRecord, CoreError, EnrollmentStorePort | ClockPort>

    processWebhookEvent: (
      resendMessageId: string,
      eventType: EmailSendStatus,
      data: EmailSendTimestamps
    ) => Effect.Effect<EmailSendRecord | null, CoreError, EmailSendStorePort>

    getCampaignAnalytics: (
      campaignId: string
    ) => Effect.Effect<CampaignAnalytics, CoreError, EmailSendStorePort>

    getStepAnalytics: (
      campaignId: string,
      stepId: string
    ) => Effect.Effect<StepAnalytics, CoreError, EmailSendStorePort>
  }
>() {}

export const EmailCampaignServiceLive = Layer.effect(
  EmailCampaignService,
  Effect.succeed({
    createCampaign: (input: CreateCampaignInput) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort

        const created = yield* campaignStore.create(input).pipe(
          Effect.mapError(toCoreInternal('Failed to create campaign'))
        )

        return created
      }),

    updateCampaign: (id: string, input: UpdateCampaignInput) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort

        const existing = yield* campaignStore.findById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (existing.status === 'archived') {
          return yield* Effect.fail(badRequest('Cannot update an archived campaign'))
        }

        const updated = yield* campaignStore.updateById(id, input).pipe(
          Effect.mapError(toCoreInternal('Failed to update campaign'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        return updated
      }),

    activateCampaign: (id: string) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort
        const stepStore = yield* CampaignStepStorePort

        const existing = yield* campaignStore.findById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (!isValidTransition(existing.status, 'active')) {
          return yield* Effect.fail(
            badRequest(`Cannot transition campaign from '${existing.status}' to 'active'`)
          )
        }

        const steps = yield* stepStore.findByCampaign(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign steps'))
        )

        if (!canActivateCampaign(steps.length)) {
          return yield* Effect.fail(
            badRequest('Campaign must have at least one step to be activated')
          )
        }

        const updated = yield* campaignStore.updateById(id, { status: 'active' }).pipe(
          Effect.mapError(toCoreInternal('Failed to activate campaign'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        return updated
      }),

    pauseCampaign: (id: string) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort

        const existing = yield* campaignStore.findById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (!isValidTransition(existing.status, 'paused')) {
          return yield* Effect.fail(
            badRequest(`Cannot transition campaign from '${existing.status}' to 'paused'`)
          )
        }

        const updated = yield* campaignStore.updateById(id, { status: 'paused' }).pipe(
          Effect.mapError(toCoreInternal('Failed to pause campaign'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        return updated
      }),

    resumeCampaign: (id: string) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort

        const existing = yield* campaignStore.findById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (!isValidTransition(existing.status, 'active')) {
          return yield* Effect.fail(
            badRequest(`Cannot transition campaign from '${existing.status}' to 'active'`)
          )
        }

        const updated = yield* campaignStore.updateById(id, { status: 'active' }).pipe(
          Effect.mapError(toCoreInternal('Failed to resume campaign'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        return updated
      }),

    archiveCampaign: (id: string) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort
        const enrollmentStore = yield* EnrollmentStorePort

        const existing = yield* campaignStore.findById(id).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (!isValidTransition(existing.status, 'archived')) {
          return yield* Effect.fail(
            badRequest(`Cannot transition campaign from '${existing.status}' to 'archived'`)
          )
        }

        yield* enrollmentStore.cancelAllForCampaign(id, 'campaign_archived').pipe(
          Effect.mapError(toCoreInternal('Failed to cancel enrollments'))
        )

        const updated = yield* campaignStore.updateById(id, { status: 'archived' }).pipe(
          Effect.mapError(toCoreInternal('Failed to archive campaign'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        return updated
      }),

    addStep: (campaignId, input) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort
        const stepStore = yield* CampaignStepStorePort

        const campaign = yield* campaignStore.findById(campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!campaign) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (!canModifySteps(campaign.status)) {
          return yield* Effect.fail(
            badRequest('Steps can only be added to campaigns in draft status')
          )
        }

        const existingSteps = yield* stepStore.findByCampaign(campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign steps'))
        )

        const nextOrder = Math.max(...existingSteps.map((s) => s.stepOrder), 0) + 1

        const step = yield* stepStore.create({
          campaignId,
          stepOrder: nextOrder,
          subject: input.subject,
          templateId: input.templateId,
          templateData: input.templateData,
          delaySeconds: input.delaySeconds
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to add step'))
        )

        return step
      }),

    updateStep: (campaignId, stepId, input) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort
        const stepStore = yield* CampaignStepStorePort

        const campaign = yield* campaignStore.findById(campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!campaign) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        const hasStructuralChanges = input.delaySeconds !== undefined
        if (hasStructuralChanges && !canModifySteps(campaign.status)) {
          return yield* Effect.fail(
            badRequest('Structural step changes are only allowed in draft status')
          )
        }

        const existingStep = yield* stepStore.findById(stepId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch step'))
        )

        if (existingStep?.campaignId !== campaignId) {
          return yield* Effect.fail(notFound('Step not found'))
        }

        const updated = yield* stepStore.updateById(stepId, input).pipe(
          Effect.mapError(toCoreInternal('Failed to update step'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Step not found'))
        }

        return updated
      }),

    removeStep: (campaignId, stepId) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort
        const stepStore = yield* CampaignStepStorePort

        const campaign = yield* campaignStore.findById(campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!campaign) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (!canModifySteps(campaign.status)) {
          return yield* Effect.fail(
            badRequest('Steps can only be removed from campaigns in draft status')
          )
        }

        const existingStep = yield* stepStore.findById(stepId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch step'))
        )

        if (existingStep?.campaignId !== campaignId) {
          return yield* Effect.fail(notFound('Step not found'))
        }

        const result = yield* stepStore.deleteById(stepId).pipe(
          Effect.mapError(toCoreInternal('Failed to remove step'))
        )

        return result
      }),

    enrollUser: (campaignId, userId) =>
      Effect.gen(function* () {
        const campaignStore = yield* CampaignStorePort
        const enrollmentStore = yield* EnrollmentStorePort
        const unsubscribeStore = yield* UnsubscribeStorePort

        const campaign = yield* campaignStore.findById(campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch campaign'))
        )

        if (!campaign) {
          return yield* Effect.fail(notFound('Campaign not found'))
        }

        if (campaign.status !== 'active') {
          return yield* Effect.fail(
            badRequest('Users can only be enrolled in active campaigns')
          )
        }

        const isUnsubscribed = yield* unsubscribeStore.isUnsubscribed(userId, campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to check unsubscribe status'))
        )

        if (isUnsubscribed) {
          return yield* Effect.fail(
            conflict('User has unsubscribed from this campaign')
          )
        }

        const existingEnrollment = yield* enrollmentStore
          .findByCampaignAndUser(campaignId, userId)
          .pipe(Effect.mapError(toCoreInternal('Failed to check existing enrollment')))

        if (existingEnrollment?.status === 'active') {
          return yield* Effect.fail(
            conflict('User is already enrolled in this campaign')
          )
        }

        // Re-enroll: if enrollment exists with terminal status, UPDATE instead of INSERT
        // to avoid unique constraint violation on (campaignId, userId)
        if (existingEnrollment && (existingEnrollment.status === 'cancelled' || existingEnrollment.status === 'completed' || existingEnrollment.status === 'failed')) {
          const clock = yield* ClockPort
          const now = yield* clock.now()

          const reactivated = yield* enrollmentStore.updateById(existingEnrollment.id, {
            status: 'active',
            cancelReason: null,
            cancelledAt: null,
            completedAt: null,
            currentStepOrder: null,
            temporalWorkflowId: null,
            enrolledAt: now
          }).pipe(
            Effect.mapError(toCoreInternal('Failed to re-enroll user'))
          )

          if (!reactivated) {
            return yield* Effect.fail(notFound('Enrollment not found'))
          }

          return reactivated
        }

        const enrollment = yield* enrollmentStore.create({
          campaignId,
          userId
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to enroll user'))
        )

        return enrollment
      }),

    cancelEnrollment: (enrollmentId, reason) =>
      Effect.gen(function* () {
        const enrollmentStore = yield* EnrollmentStorePort
        const clock = yield* ClockPort

        const existing = yield* enrollmentStore.findById(enrollmentId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch enrollment'))
        )

        if (!existing) {
          return yield* Effect.fail(notFound('Enrollment not found'))
        }

        if (existing.status !== 'active') {
          return yield* Effect.fail(
            badRequest('Only active enrollments can be cancelled')
          )
        }

        const now = yield* clock.now()

        const knownReasons: Record<string, 'user_unsubscribed' | 'suppressed'> = {
          user_unsubscribed: 'user_unsubscribed',
          suppressed: 'suppressed'
        }
        const cancelReason = knownReasons[reason] ?? 'admin_cancelled'

        const updated = yield* enrollmentStore.updateById(enrollmentId, {
          status: 'cancelled',
          cancelReason,
          cancelledAt: now
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to cancel enrollment'))
        )

        if (!updated) {
          return yield* Effect.fail(notFound('Enrollment not found'))
        }

        return updated
      }),

    processWebhookEvent: (resendMessageId, eventType, data) =>
      Effect.gen(function* () {
        const sendStore = yield* EmailSendStorePort

        const send = yield* sendStore.findByResendMessageId(resendMessageId).pipe(
          Effect.mapError(toCoreInternal('Failed to find email send'))
        )

        if (!send) {
          return null
        }

        if (!canAdvanceEmailSendStatus(send.status, eventType)) {
          return send
        }

        const updated = yield* sendStore.updateStatus(send.id, eventType, data).pipe(
          Effect.mapError(toCoreInternal('Failed to update email send status'))
        )

        return updated
      }),

    getCampaignAnalytics: (campaignId) =>
      Effect.gen(function* () {
        const sendStore = yield* EmailSendStorePort

        const analytics = yield* sendStore.aggregateByCampaign(campaignId).pipe(
          Effect.mapError(toCoreInternal('Failed to aggregate campaign analytics'))
        )

        return analytics
      }),

    getStepAnalytics: (campaignId, stepId) =>
      Effect.gen(function* () {
        const sendStore = yield* EmailSendStorePort

        const analytics = yield* sendStore.aggregateByStep(campaignId, stepId).pipe(
          Effect.mapError(toCoreInternal('Failed to aggregate step analytics'))
        )

        return analytics
      })
  })
)
