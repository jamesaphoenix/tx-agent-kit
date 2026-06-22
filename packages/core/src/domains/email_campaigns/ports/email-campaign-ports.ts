import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { DomainEventAggregateType, DomainEventType, EmailSourceSystem, EmailSuppressionReason } from '@tx-agent-kit/contracts'
import type { JsonObject } from '@tx-agent-kit/db'
import type {
  CampaignRecord,
  CampaignStepRecord,
  CreateCampaignInput,
  CreateEmailSendInput,
  CreateEnrollmentInput,
  EmailSendRecord,
  EmailSendTimestamps,
  EnrollmentRecord,
  CampaignFilter,
  UpdateCampaignInput,
  UpdateEnrollmentInput,
  CampaignAnalytics,
  StepAnalytics,
  UnsubscribeRecord,
  EmailSendStatus
} from '../domain/email-campaign-domain.js'

export const EmailCampaignRepositoryKind = 'custom' as const

export class CampaignStorePort extends Context.Tag('CampaignStorePort')<
  CampaignStorePort,
  {
    create: (input: CreateCampaignInput) => Effect.Effect<CampaignRecord, unknown>
    findById: (id: string) => Effect.Effect<CampaignRecord | null, unknown>
    findMany: (filter: CampaignFilter) => Effect.Effect<ReadonlyArray<CampaignRecord>, unknown>
    updateById: (
      id: string,
      input: UpdateCampaignInput
    ) => Effect.Effect<CampaignRecord | null, unknown>
    findActiveByCampaignTrigger: (
      triggerConfig: unknown
    ) => Effect.Effect<ReadonlyArray<CampaignRecord>, unknown>
  }
>() {}

export class EnrollmentStorePort extends Context.Tag('EnrollmentStorePort')<
  EnrollmentStorePort,
  {
    create: (input: CreateEnrollmentInput) => Effect.Effect<EnrollmentRecord, unknown>
    findById: (id: string) => Effect.Effect<EnrollmentRecord | null, unknown>
    findByCampaignAndUser: (
      campaignId: string,
      userId: string
    ) => Effect.Effect<EnrollmentRecord | null, unknown>
    findManyByCampaign: (
      campaignId: string,
      filter?: { status?: EnrollmentRecord['status'] }
    ) => Effect.Effect<ReadonlyArray<EnrollmentRecord>, unknown>
    updateById: (
      id: string,
      input: UpdateEnrollmentInput
    ) => Effect.Effect<EnrollmentRecord | null, unknown>
    cancelAllForCampaign: (
      campaignId: string,
      reason: EnrollmentRecord['cancelReason'] & string
    ) => Effect.Effect<number, unknown>
    /** Cancel every active enrollment for a user (global unsubscribe cleanup). */
    cancelAllActiveForUser: (
      userId: string,
      reason: EnrollmentRecord['cancelReason'] & string
    ) => Effect.Effect<number, unknown>
  }
>() {}

export class EmailSendStorePort extends Context.Tag('EmailSendStorePort')<
  EmailSendStorePort,
  {
    create: (input: CreateEmailSendInput) => Effect.Effect<EmailSendRecord, unknown>
    findByResendMessageId: (
      resendMessageId: string
    ) => Effect.Effect<EmailSendRecord | null, unknown>
    findByEnrollmentAndStep: (
      enrollmentId: string,
      stepId: string
    ) => Effect.Effect<EmailSendRecord | null, unknown>
    updateStatus: (
      id: string,
      status: EmailSendStatus,
      timestamps: EmailSendTimestamps
    ) => Effect.Effect<EmailSendRecord | null, unknown>
    aggregateByCampaign: (campaignId: string) => Effect.Effect<CampaignAnalytics, unknown>
    aggregateByStep: (
      campaignId: string,
      stepId: string
    ) => Effect.Effect<StepAnalytics, unknown>
    pruneOlderThan: (cutoffDate: Date) => Effect.Effect<number, unknown>
  }
>() {}

export class CampaignStepStorePort extends Context.Tag('CampaignStepStorePort')<
  CampaignStepStorePort,
  {
    create: (input: {
      campaignId: string
      stepOrder: number
      subject: string
      templateId: string
      templateData?: unknown
      delaySeconds?: number
    }) => Effect.Effect<CampaignStepRecord, unknown>
    findByCampaign: (campaignId: string) => Effect.Effect<ReadonlyArray<CampaignStepRecord>, unknown>
    findById: (id: string) => Effect.Effect<CampaignStepRecord | null, unknown>
    updateById: (
      id: string,
      input: {
        subject?: string
        templateId?: string
        templateData?: unknown
        delaySeconds?: number
      }
    ) => Effect.Effect<CampaignStepRecord | null, unknown>
    deleteById: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    reorder: (
      campaignId: string,
      stepIds: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<CampaignStepRecord>, unknown>
  }
>() {}

export class UnsubscribeStorePort extends Context.Tag('UnsubscribeStorePort')<
  UnsubscribeStorePort,
  {
    isUnsubscribed: (
      userId: string,
      campaignId: string | null
    ) => Effect.Effect<boolean, unknown>
    unsubscribe: (input: {
      userId: string
      campaignId: string | null
    }) => Effect.Effect<UnsubscribeRecord, unknown>
  }
>() {}

/** Writes the email suppression list (hard bounces / spam complaints). The drip
 * sweep + enroll read it via the send path; this is the missing write side. */
export class SuppressionStorePort extends Context.Tag('SuppressionStorePort')<
  SuppressionStorePort,
  {
    suppress: (input: {
      email: string
      reason: EmailSuppressionReason
      sourceSystem: EmailSourceSystem
      sourceId: string | null
    }) => Effect.Effect<void, unknown>
  }
>() {}

/**
 * Resolves the email + display name for a user id. enrollUser needs both to
 * populate the email_campaigns.enrollment_triggered outbox payload (the
 * dispatcher rejects the event as invalid without userEmail/userName), but the
 * enrollment route only carries user ids. Implemented by an infra adapter over
 * the users table so the email_campaigns domain never imports users internals.
 */
export class UserInfoLookupPort extends Context.Tag('UserInfoLookupPort')<
  UserInfoLookupPort,
  {
    getUserInfo: (
      userId: string
    ) => Effect.Effect<{ email: string; name: string } | null, unknown>
  }
>() {}

/**
 * Emits a standalone outbox event for the email_campaigns domain. enrollUser
 * uses this to publish email_campaigns.enrollment_triggered after the
 * enrollment row is written, which is what actually starts the drip workflow.
 *
 * The port lives in the email_campaigns domain (mirroring the assets domain's
 * DomainEventOutboxPort) so the application layer stays free of any direct
 * @tx-agent-kit/db dependency.
 */
export class EmailCampaignDomainEventOutboxPort extends Context.Tag('EmailCampaignDomainEventOutboxPort')<
  EmailCampaignDomainEventOutboxPort,
  {
    emit: (input: {
      eventType: DomainEventType
      aggregateType: DomainEventAggregateType
      aggregateId: string
      payload: JsonObject
      correlationId?: string | null
    }) => Effect.Effect<void, unknown>
  }
>() {}
