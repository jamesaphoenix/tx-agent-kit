import type {
  CreditLedgerRowShape,
  OrganizationRowShape,
  SubscriptionEventRowShape,
  UsageRecordRowShape
} from '@tx-agent-kit/db'
import type {
  BillingSettingsRecord,
  CreditLedgerEntryRecord,
  SubscriptionEventRecord,
  UsageRecordRecord
} from '../domains/billing/domain/billing-domain.js'

export const toBillingSettingsRecord = (row: OrganizationRowShape): BillingSettingsRecord => row

export const toUsageRecordRecord = (row: UsageRecordRowShape): UsageRecordRecord => row

export const toSubscriptionEventRecord = (
  row: SubscriptionEventRowShape
): SubscriptionEventRecord => row

export const toCreditLedgerEntryRecord = (
  row: CreditLedgerRowShape
): CreditLedgerEntryRecord => row
