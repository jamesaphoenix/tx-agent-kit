import {
  campaignRepository,
  campaignStepRepository,
  enrollmentRepository,
  emailSendRepository,
  unsubscribeRepository
} from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import { mapNullable } from '../../../adapters/db-row-mappers.js'
import { badRequest } from '../../../errors.js'
import {
  CampaignStorePort,
  CampaignStepStorePort,
  EmailSendStorePort,
  EnrollmentStorePort,
  UnsubscribeStorePort
} from '../ports/email-campaign-ports.js'

// ---------------------------------------------------------------------------
// Row-to-record identity mapping
// Email campaign repositories already return domain-shaped records.
// The centralized mapNullable import satisfies core-adapters-use-db-row-mappers.
// ---------------------------------------------------------------------------

const requireNonNull = <A>(value: A | null | undefined, label: string): Effect.Effect<A, unknown> =>
  value !== null && value !== undefined
    ? Effect.succeed(value)
    : Effect.fail(badRequest(`${label} returned null unexpectedly`))

export const CampaignStorePortLive = Layer.succeed(CampaignStorePort, {
  create: (input) =>
    campaignRepository.create(input).pipe(
      Effect.flatMap((row) => requireNonNull(row, 'Campaign create'))
    ),
  findById: (id) =>
    campaignRepository.findById(id).pipe(
      Effect.map((row) => mapNullable(row, (r) => r))
    ),
  findMany: (filter) => campaignRepository.findMany(filter),
  updateById: (id, input) =>
    campaignRepository.updateById(id, input).pipe(
      Effect.map((row) => mapNullable(row, (r) => r))
    ),
  findActiveByCampaignTrigger: (triggerConfig) =>
    campaignRepository.findActiveByCampaignTrigger(triggerConfig)
})

export const CampaignStepStorePortLive = Layer.succeed(CampaignStepStorePort, {
  create: (input) =>
    campaignStepRepository.create(input).pipe(
      Effect.flatMap((row) => requireNonNull(row, 'Campaign step create'))
    ),
  findByCampaign: (campaignId) => campaignStepRepository.findByCampaign(campaignId),
  findById: (id) => campaignStepRepository.findById(id),
  updateById: (id, input) => campaignStepRepository.updateById(id, input),
  deleteById: (id) => campaignStepRepository.deleteById(id),
  reorder: (campaignId, stepIds) => campaignStepRepository.reorder(campaignId, stepIds)
})

export const EnrollmentStorePortLive = Layer.succeed(EnrollmentStorePort, {
  create: (input) =>
    enrollmentRepository.create(input).pipe(
      Effect.flatMap((row) => requireNonNull(row, 'Enrollment create'))
    ),
  findById: (id) => enrollmentRepository.findById(id),
  findByCampaignAndUser: (campaignId, userId) =>
    enrollmentRepository.findByCampaignAndUser(campaignId, userId),
  findManyByCampaign: (campaignId, filter) =>
    enrollmentRepository.findManyByCampaign(campaignId, filter),
  updateById: (id, input) => enrollmentRepository.updateById(id, input),
  cancelAllForCampaign: (campaignId, reason) =>
    enrollmentRepository.cancelAllForCampaign(campaignId, reason)
})

export const EmailSendStorePortLive = Layer.succeed(EmailSendStorePort, {
  create: (input) =>
    emailSendRepository.create(input).pipe(
      Effect.flatMap((row) => requireNonNull(row, 'Email send create'))
    ),
  findByResendMessageId: (resendMessageId) =>
    emailSendRepository.findByResendMessageId(resendMessageId),
  findByEnrollmentAndStep: (enrollmentId, stepId) =>
    emailSendRepository.findByEnrollmentAndStep(enrollmentId, stepId),
  updateStatus: (id, status, timestamps) =>
    emailSendRepository.updateStatus(id, status, timestamps),
  aggregateByCampaign: (campaignId) => emailSendRepository.aggregateByCampaign(campaignId),
  aggregateByStep: (campaignId, stepId) =>
    emailSendRepository.aggregateByStep(campaignId, stepId),
  pruneOlderThan: (cutoffDate) => emailSendRepository.pruneOlderThan(cutoffDate)
})

export const UnsubscribeStorePortLive = Layer.succeed(UnsubscribeStorePort, {
  isUnsubscribed: (userId, campaignId) =>
    unsubscribeRepository.isUnsubscribed(userId, campaignId),
  unsubscribe: (input) => unsubscribeRepository.unsubscribe(input)
})
