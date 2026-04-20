import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
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
