import {
  autoRechargeAttemptsRepository,
  billingRepository,
  creditLedgerRepository,
  organizationsRepository,
  processedStripeEventsRepository,
  storageMeteringRepository,
  storageUsageRepository,
  subscriptionEventsRepository,
  userUiPreferencesRepository,
  usageCapRepository,
  usageRecordsRepository
} from '@tx-agent-kit/db'
import { Effect, Layer, Option } from 'effect'
import {
  mapOptional,
  toBillingSettingsRecord,
  toCreditLedgerEntryRecord,
  toSubscriptionEventRecord,
  toUsageRecordRecord
} from '../../../adapters/db-row-mappers.js'
import {
  AutoRechargeAttemptStorePort,
  BillingGuardPort,
  BillingStorePort,
  BillingUiPreferenceStorePort,
  ClockPort,
  CreditLedgerStorePort,
  ProcessedStripeEventStorePort,
  StorageUsageReaderPort,
  SubscriptionEventStorePort,
  UsageCapStorePort,
  UsageStorePort
} from '../ports/billing-ports.js'

export const BillingStorePortLive = Layer.succeed(BillingStorePort, {
  getSubscriptionFields: (organizationId: string) =>
    billingRepository
      .getSubscriptionFields(organizationId)
      .pipe(Effect.map((opt) => mapOptional(opt, toBillingSettingsRecord))),
  findByStripeCustomerId: (stripeCustomerId: string) =>
    billingRepository
      .findByStripeCustomerId(stripeCustomerId)
      .pipe(Effect.map((opt) => mapOptional(opt, toBillingSettingsRecord))),
  findByStripeSubscriptionId: (stripeSubscriptionId: string) =>
    billingRepository
      .findByStripeSubscriptionId(stripeSubscriptionId)
      .pipe(Effect.map((opt) => mapOptional(opt, toBillingSettingsRecord))),
  updateSubscriptionFields: (input) =>
    billingRepository
      .updateSubscriptionFields(input)
      .pipe(Effect.map((opt) => mapOptional(opt, toBillingSettingsRecord))),
  updateBillingSettings: (input) =>
    billingRepository
      .updateBillingSettings(input)
      .pipe(Effect.map((opt) => mapOptional(opt, toBillingSettingsRecord))),
  claimStripeCustomerId: (input) =>
    billingRepository.claimStripeCustomerId(input),
  getMemberRole: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(
      Effect.map((opt) => Option.map(opt, (row) => row.role))
    )
})

export const UsageStorePortLive = Layer.succeed(UsageStorePort, {
  record: (input) =>
    usageRecordsRepository.record(input).pipe(
      Effect.map((opt) => mapOptional(opt, toUsageRecordRecord))
    ),
  updateStripeUsageRecordId: (id: string, stripeUsageRecordId: string) =>
    usageRecordsRepository.updateStripeUsageRecordId(id, stripeUsageRecordId).pipe(
      Effect.map((opt) => mapOptional(opt, toUsageRecordRecord))
    ),
  findByReferenceId: (organizationId: string, referenceId: string) =>
    usageRecordsRepository.findByReferenceId(organizationId, referenceId).pipe(
      Effect.map((opt) => mapOptional(opt, toUsageRecordRecord))
    ),
  listForOrganization: (input) =>
    usageRecordsRepository.listForOrganization(input).pipe(
      Effect.map((rows) => rows.map(toUsageRecordRecord))
    ),
  summarizeForPeriod: (input) =>
    usageRecordsRepository.summarizeForPeriod(input)
})

export const BillingUiPreferenceStorePortLive = Layer.succeed(BillingUiPreferenceStorePort, {
  isNoCapReminderDismissed: (userId: string, organizationId: string) =>
    userUiPreferencesRepository.isBillingNoCapReminderDismissed({ userId, organizationId }),
  dismissNoCapReminder: (userId: string, organizationId: string) =>
    userUiPreferencesRepository.dismissBillingNoCapReminder({ userId, organizationId })
})

export const SubscriptionEventStorePortLive = Layer.succeed(SubscriptionEventStorePort, {
  findByStripeEventId: (stripeEventId: string) =>
    subscriptionEventsRepository.findByStripeEventId(stripeEventId).pipe(
      Effect.map((opt) => mapOptional(opt, toSubscriptionEventRecord))
    ),
  create: (input) =>
    subscriptionEventsRepository.create(input).pipe(
      Effect.map((opt) => mapOptional(opt, toSubscriptionEventRecord))
    ),
  markProcessed: (id: string) =>
    subscriptionEventsRepository.markProcessed(id).pipe(
      Effect.map((opt) => mapOptional(opt, toSubscriptionEventRecord))
    )
})

export const BillingGuardDisabledPortLive = Layer.succeed(BillingGuardPort, {
  isEnabled: () => Effect.succeed(false)
})

export const ClockPortLive = Layer.succeed(ClockPort, {
  now: () => Effect.sync(() => new Date())
})

export const CreditLedgerStorePortLive = Layer.succeed(CreditLedgerStorePort, {
  append: (input) =>
    creditLedgerRepository.append(input).pipe(
      Effect.map(toCreditLedgerEntryRecord)
    ),
  finalizeReservation: (input) =>
    creditLedgerRepository.finalizeReservation(input).pipe(
      Effect.map(toCreditLedgerEntryRecord)
    ),
  listForOrganization: (input) =>
    creditLedgerRepository.listForOrganization(input).pipe(
      Effect.map((rows) => rows.map(toCreditLedgerEntryRecord))
    ),
  existsByStripeEventId: (stripeEventId: string) =>
    creditLedgerRepository.existsByStripeEventId(stripeEventId)
})

export const ProcessedStripeEventStorePortLive = Layer.succeed(ProcessedStripeEventStorePort, {
  tryInsert: (eventId: string) =>
    processedStripeEventsRepository.tryInsert(eventId),
  findById: (eventId: string) =>
    processedStripeEventsRepository.findById(eventId),
  deleteByEventId: (eventId: string) =>
    processedStripeEventsRepository.deleteByEventId(eventId)
})

export const UsageCapStorePortLive = Layer.succeed(UsageCapStorePort, {
  getOrgCapState: (orgId: string, periodStart: Date, periodEnd: Date) =>
    usageCapRepository.getOrgCapState({ orgId, periodStart, periodEnd }).pipe(
      Effect.map((opt) =>
        Option.map(opt, (row) => ({
          usageCapDecimillicents: row.usageCap,
          creditsUsed: row.creditsUsed
        }))
      )
    ),
  incrementMonthlyUsage: (
    orgId: string,
    periodStart: Date,
    periodEnd: Date,
    deltaDecimillicents: number,
    planTier: string | null
  ) =>
    usageCapRepository.incrementMonthlyUsage({
      orgId,
      periodStart,
      periodEnd,
      deltaDecimillicents,
      planTier
    }),
  incrementMonthlyUsageAndEmit: (
    orgId: string,
    periodStart: Date,
    periodEnd: Date,
    deltaDecimillicents: number,
    planTier: string | null
  ) =>
    usageCapRepository.incrementMonthlyUsageAndEmit({
      orgId,
      periodStart,
      periodEnd,
      deltaDecimillicents,
      planTier
    }),
  emitUsageCapExceeded: (orgId: string, capDecimillicents: number) =>
    usageCapRepository.emitUsageCapExceeded({ orgId, capDecimillicents })
})

export const AutoRechargeAttemptStorePortLive = Layer.succeed(AutoRechargeAttemptStorePort, {
  findLatestRequiresActionChallenge: (organizationId: string) =>
    autoRechargeAttemptsRepository.findLatestRequiresActionChallenge(organizationId),
  markAttemptSucceeded: (attemptId: string, stripePaymentIntentId: string) =>
    autoRechargeAttemptsRepository.markSucceeded(attemptId, stripePaymentIntentId),
  markAttemptFailed: (
    attemptId: string,
    reason: string,
    stripePaymentIntentId: string | null = null
  ) =>
    autoRechargeAttemptsRepository.markFailed(attemptId, reason, stripePaymentIntentId),
  markAttemptRequiresActionAndEmit: (input) =>
    autoRechargeAttemptsRepository.markRequiresActionAndEmit(input)
})

export const StorageUsageReaderPortLive = Layer.succeed(StorageUsageReaderPort, {
  getRealtimeBytes: (organizationId: string) =>
    storageMeteringRepository.getForOrganization(organizationId).pipe(
      Effect.map((opt) => Option.map(opt, (row) => row.activeBytes))
    ),
  getCurrentPeriodUsage: (organizationId: string) =>
    storageUsageRepository.getCurrentForOrganization(organizationId).pipe(
      Effect.map((opt) =>
        Option.map(opt, (row) => ({
          currentBytes: row.currentBytes,
          planStorageLimit: row.planStorageLimit,
          planTier: row.planTier,
          periodStart: row.periodStart
        }))
      )
    )
})
