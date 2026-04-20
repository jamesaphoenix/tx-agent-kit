import { HttpApiBuilder } from '@effect/platform'
import {
  CampaignStorePort,
  CampaignStepStorePort,
  EmailCampaignService,
  EnrollmentStorePort
} from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { BadRequest, NotFound, Unauthorized, TxAgentApi, mapCoreError } from '../api.js'
import { toApiCampaign, toApiCampaignStep, toApiEnrollment } from '../mappers/email-campaign-mapper.js'
import { requireAuth } from '../utils.js'

const requireAdminRole = Effect.gen(function* () {
  const principal = yield* requireAuth
  const isAdmin = principal.roles.includes('admin')
  if (!isAdmin) {
    return yield* Effect.fail(new Unauthorized({ message: 'Admin role required' }))
  }
  return principal
})

export const EmailCampaignsRouteKind = 'crud' as const

export const EmailCampaignsLive = HttpApiBuilder.group(TxAgentApi, 'emailCampaigns', (handlers) =>
  handlers
    // --- Campaign CRUD ---
    .handle('listCampaigns', ({ urlParams }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const campaignStore = yield* CampaignStorePort

        const campaigns = yield* campaignStore
          .findMany({
            status: urlParams.status,
            campaignType: urlParams.campaignType
          })
          .pipe(Effect.mapError(mapCoreError))

        return { data: campaigns.map(toApiCampaign) }
      })
    )
    .handle('createCampaign', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAdminRole
        const service = yield* EmailCampaignService
        const campaign = yield* service
          .createCampaign({
            name: payload.name,
            description: payload.description,
            campaignType: payload.campaignType,
            triggerConfig: payload.triggerConfig,
            audienceFilter: payload.audienceFilter,
            fromName: payload.fromName,
            replyTo: payload.replyTo,
            createdBy: principal.userId
          })
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaign(campaign)
      })
    )
    .handle('getCampaign', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const campaignStore = yield* CampaignStorePort

        const campaign = yield* campaignStore
          .findById(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))

        if (!campaign) {
          return yield* Effect.fail(new NotFound({ message: 'Campaign not found' }))
        }

        return toApiCampaign(campaign)
      })
    )
    .handle('updateCampaign', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        const campaign = yield* service
          .updateCampaign(path.campaignId, payload)
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaign(campaign)
      })
    )
    // --- Lifecycle ---
    .handle('activateCampaign', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        const campaign = yield* service
          .activateCampaign(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaign(campaign)
      })
    )
    .handle('pauseCampaign', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        const campaign = yield* service
          .pauseCampaign(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaign(campaign)
      })
    )
    .handle('resumeCampaign', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        const campaign = yield* service
          .resumeCampaign(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaign(campaign)
      })
    )
    .handle('archiveCampaign', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        // NOTE: After archiving, cancelled enrollments still have temporalWorkflowId values.
        // The service's cancelAllForCampaign cancels DB enrollment rows but does not signal
        // Temporal workflows. A domain event (e.g. 'email_campaign.archived') should be emitted
        // here so the worker can cancel the corresponding Temporal workflows. This follows the
        // transactional outbox pattern — apps/api must not import @temporalio/* directly.
        const campaign = yield* service
          .archiveCampaign(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaign(campaign)
      })
    )
    // --- Steps ---
    .handle('listSteps', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const stepStore = yield* CampaignStepStorePort

        const steps = yield* stepStore
          .findByCampaign(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))

        return { data: steps.map(toApiCampaignStep) }
      })
    )
    .handle('addStep', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        const step = yield* service
          .addStep(path.campaignId, {
            subject: payload.subject,
            templateId: payload.templateId,
            templateData: payload.templateData,
            delaySeconds: payload.delaySeconds
          })
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaignStep(step)
      })
    )
    .handle('updateStep', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        const step = yield* service
          .updateStep(path.campaignId, path.stepId, {
            subject: payload.subject,
            templateId: payload.templateId,
            templateData: payload.templateData,
            delaySeconds: payload.delaySeconds
          })
          .pipe(Effect.mapError(mapCoreError))
        return toApiCampaignStep(step)
      })
    )
    .handle('removeStep', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        return yield* service
          .removeStep(path.campaignId, path.stepId)
          .pipe(Effect.mapError(mapCoreError))
      })
    )
    // --- Enrollments ---
    .handle('listEnrollments', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const enrollmentStore = yield* EnrollmentStorePort

        const enrollments = yield* enrollmentStore
          .findManyByCampaign(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))

        return { data: enrollments.map(toApiEnrollment) }
      })
    )
    .handle('enrollUsers', ({ path, payload }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService

        if (payload.userIds.length === 0) {
          return yield* Effect.fail(new BadRequest({ message: 'At least one userId is required' }))
        }

        const results = yield* Effect.forEach(
          payload.userIds,
          (userId) =>
            service.enrollUser(path.campaignId, userId).pipe(
              Effect.map((enrollment) => ({
                userId,
                enrolled: true as boolean,
                enrollmentId: enrollment.id
              })),
              Effect.catchAll((error) =>
                Effect.succeed({
                  userId,
                  enrolled: false as boolean,
                  error: error.message
                })
              )
            ),
          { concurrency: 1 }
        )

        return { results }
      })
    )
    .handle('cancelEnrollment', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const enrollmentStore = yield* EnrollmentStorePort
        const service = yield* EmailCampaignService

        // Verify enrollment belongs to the campaign in the URL path
        const existing = yield* enrollmentStore
          .findById(path.enrollmentId)
          .pipe(Effect.mapError(mapCoreError))

        if (existing?.campaignId !== path.campaignId) {
          return yield* Effect.fail(new NotFound({ message: 'Enrollment not found' }))
        }

        const enrollment = yield* service
          .cancelEnrollment(path.enrollmentId, 'admin_cancelled')
          .pipe(Effect.mapError(mapCoreError))
        return toApiEnrollment(enrollment)
      })
    )
    // --- Analytics ---
    .handle('getCampaignAnalytics', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        return yield* service
          .getCampaignAnalytics(path.campaignId)
          .pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('getStepAnalytics', ({ path }) =>
      Effect.gen(function* () {
        yield* requireAdminRole
        const service = yield* EmailCampaignService
        return yield* service
          .getStepAnalytics(path.campaignId, path.stepId)
          .pipe(Effect.mapError(mapCoreError))
      })
    )
)
