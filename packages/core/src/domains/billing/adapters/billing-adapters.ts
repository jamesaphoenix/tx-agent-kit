import {
  billingRepository,
  organizationsRepository,
  subscriptionEventsRepository,
  usageRecordsRepository
} from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import {
  mapNullable,
  toBillingSettingsRecord,
  toCreditLedgerEntryRecord,
  toSubscriptionEventRecord,
  toUsageRecordRecord
} from '../../../adapters/db-row-mappers.js'
import {
  BillingGuardPort,
  BillingStorePort,
  ClockPort,
  SubscriptionEventStorePort,
  UsageStorePort
} from '../ports/billing-ports.js'

export const BillingStorePortLive = Layer.succeed(BillingStorePort, {
  getSubscriptionFields: (organizationId: string) =>
    billingRepository
      .getSubscriptionFields(organizationId)
      .pipe(Effect.map((row) => mapNullable(row, toBillingSettingsRecord))),
  findByStripeCustomerId: (stripeCustomerId: string) =>
    billingRepository
      .findByStripeCustomerId(stripeCustomerId)
      .pipe(Effect.map((row) => mapNullable(row, toBillingSettingsRecord))),
  findByStripeSubscriptionId: (stripeSubscriptionId: string) =>
    billingRepository
      .findByStripeSubscriptionId(stripeSubscriptionId)
      .pipe(Effect.map((row) => mapNullable(row, toBillingSettingsRecord))),
  updateSubscriptionFields: (input) =>
    billingRepository
      .updateSubscriptionFields(input)
      .pipe(Effect.map((row) => mapNullable(row, toBillingSettingsRecord))),
  updateBillingSettings: (input) =>
    billingRepository
      .updateBillingSettings(input)
      .pipe(Effect.map((row) => mapNullable(row, toBillingSettingsRecord))),
  adjustCredits: (input) =>
    billingRepository
      .adjustCredits(input)
      .pipe(Effect.map((row) => mapNullable(row, toCreditLedgerEntryRecord))),
  getMemberRole: (organizationId: string, userId: string) =>
    organizationsRepository.getMemberRole(organizationId, userId).pipe(
      Effect.map((row) => (row ? row.role : null))
    )
})

export const UsageStorePortLive = Layer.succeed(UsageStorePort, {
  record: (input) =>
    usageRecordsRepository.record(input).pipe(
      Effect.map((row) => mapNullable(row, toUsageRecordRecord))
    ),
  updateStripeUsageRecordId: (id: string, stripeUsageRecordId: string) =>
    usageRecordsRepository.updateStripeUsageRecordId(id, stripeUsageRecordId).pipe(
      Effect.map((row) => mapNullable(row, toUsageRecordRecord))
    ),
  findByReferenceId: (organizationId: string, referenceId: string) =>
    usageRecordsRepository.findByReferenceId(organizationId, referenceId).pipe(
      Effect.map((row) => mapNullable(row, toUsageRecordRecord))
    ),
  listForOrganization: (input) =>
    usageRecordsRepository.listForOrganization(input).pipe(
      Effect.map((rows) => rows.map(toUsageRecordRecord))
    ),
  summarizeForPeriod: (input) =>
    usageRecordsRepository.summarizeForPeriod(input)
})

export const SubscriptionEventStorePortLive = Layer.succeed(SubscriptionEventStorePort, {
  findByStripeEventId: (stripeEventId: string) =>
    subscriptionEventsRepository.findByStripeEventId(stripeEventId).pipe(
      Effect.map((row) => mapNullable(row, toSubscriptionEventRecord))
    ),
  create: (input) =>
    subscriptionEventsRepository.create(input).pipe(
      Effect.map((row) => mapNullable(row, toSubscriptionEventRecord))
    ),
  markProcessed: (id: string, processedAt?: Date) =>
    subscriptionEventsRepository.markProcessed(id, processedAt).pipe(
      Effect.map((row) => mapNullable(row, toSubscriptionEventRecord))
    )
})

export const BillingGuardDisabledPortLive = Layer.succeed(BillingGuardPort, {
  isEnabled: () => Effect.succeed(false)
})

export const ClockPortLive = Layer.succeed(ClockPort, {
  now: () => Effect.sync(() => new Date())
})
