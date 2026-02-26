import type {
  CreditLedgerRowShape,
  InvitationRowShape,
  OrganizationRowShape,
  SubscriptionEventRowShape,
  TeamMemberRowShape,
  TeamRowShape,
  UsageRecordRowShape,
  UserRowShape
} from '@tx-agent-kit/db'
import type { AuthUserRecord } from '../domains/auth/domain/auth-domain.js'
import type {
  BillingSettingsRecord,
  CreditLedgerEntryRecord,
  SubscriptionEventRecord,
  UsageRecordRecord
} from '../domains/billing/domain/billing-domain.js'
import type {
  InvitationRecord,
  OrganizationRecord,
  OrganizationUserRecord
} from '../domains/organization/domain/organization-domain.js'
import type { TeamMemberRecord, TeamRecord } from '../domains/team/domain/team-domain.js'
import type { PaginatedResult } from '../pagination.js'

const toRecord = <
  Row extends Record<string, unknown>,
  const Keys extends readonly (keyof Row)[]
>(
  keys: Keys
) =>
  (row: Row): Pick<Row, Keys[number]> => {
    const entries = keys.map((key) => [key, row[key]] as const)
    return Object.fromEntries(entries) as Pick<Row, Keys[number]>
  }

const mapPaginatedResult = <Input, Output>(
  page: PaginatedResult<Input>,
  mapItem: (item: Input) => Output
): PaginatedResult<Output> => ({
  data: page.data.map(mapItem),
  total: page.total,
  nextCursor: page.nextCursor,
  prevCursor: page.prevCursor
})

export const mapNullable = <Input, Output>(
  value: Input | null,
  mapItem: (item: Input) => Output
): Output | null => (value === null ? null : mapItem(value))

const toOrganizationRecordBase = toRecord<OrganizationRowShape, readonly [
  'id',
  'name',
  'billingEmail',
  'onboardingData',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'stripePaymentMethodId',
  'stripeMeteredSubscriptionItemId',
  'creditsBalance',
  'reservedCredits',
  'autoRechargeEnabled',
  'autoRechargeThreshold',
  'autoRechargeAmount',
  'isSubscribed',
  'subscriptionStatus',
  'subscriptionPlan',
  'subscriptionStartedAt',
  'subscriptionEndsAt',
  'subscriptionCurrentPeriodEnd',
  'createdAt',
  'updatedAt'
]>([
  'id', 'name',
  'billingEmail', 'onboardingData',
  'stripeCustomerId', 'stripeSubscriptionId', 'stripePaymentMethodId', 'stripeMeteredSubscriptionItemId',
  'creditsBalance', 'reservedCredits',
  'autoRechargeEnabled', 'autoRechargeThreshold', 'autoRechargeAmount',
  'isSubscribed', 'subscriptionStatus', 'subscriptionPlan',
  'subscriptionStartedAt', 'subscriptionEndsAt', 'subscriptionCurrentPeriodEnd',
  'createdAt', 'updatedAt'
] as const)

export const toOrganizationRecord = (row: OrganizationRowShape): OrganizationRecord => toOrganizationRecordBase(row)

export const toOrganizationRecordPage = (
  page: PaginatedResult<OrganizationRowShape>
): PaginatedResult<OrganizationRecord> => mapPaginatedResult(page, toOrganizationRecord)

const toInvitationRecordBase = toRecord<InvitationRowShape, readonly [
  'id',
  'organizationId',
  'inviteeUserId',
  'email',
  'role',
  'status',
  'invitedByUserId',
  'token',
  'expiresAt',
  'createdAt'
]>([
  'id',
  'organizationId',
  'inviteeUserId',
  'email',
  'role',
  'status',
  'invitedByUserId',
  'token',
  'expiresAt',
  'createdAt'
] as const)

export const toInvitationRecord = (row: InvitationRowShape): InvitationRecord => toInvitationRecordBase(row)

export const toInvitationRecordPage = (
  page: PaginatedResult<InvitationRowShape>
): PaginatedResult<InvitationRecord> => mapPaginatedResult(page, toInvitationRecord)

const mapUserRecordFields = toRecord<UserRowShape, readonly [
  'id',
  'email',
  'passwordHash',
  'passwordChangedAt',
  'name',
  'createdAt'
]>(['id', 'email', 'passwordHash', 'passwordChangedAt', 'name', 'createdAt'] as const)

export const toAuthUserRecord = (row: UserRowShape): AuthUserRecord => mapUserRecordFields(row)

export const toOrganizationUserRecord = (row: UserRowShape): OrganizationUserRecord =>
  mapUserRecordFields(row)

const toTeamRecordBase = toRecord<TeamRowShape, readonly [
  'id',
  'organizationId',
  'name',
  'website',
  'brandSettings',
  'createdAt',
  'updatedAt'
]>(['id', 'organizationId', 'name', 'website', 'brandSettings', 'createdAt', 'updatedAt'] as const)

export const toTeamRecord = (row: TeamRowShape): TeamRecord => toTeamRecordBase(row)

export const toTeamRecordPage = (page: PaginatedResult<TeamRowShape>): PaginatedResult<TeamRecord> =>
  mapPaginatedResult(page, toTeamRecord)

const toTeamMemberRecordBase = toRecord<TeamMemberRowShape, readonly [
  'id',
  'teamId',
  'userId',
  'roleId',
  'createdAt',
  'updatedAt'
]>(['id', 'teamId', 'userId', 'roleId', 'createdAt', 'updatedAt'] as const)

export const toTeamMemberRecord = (row: TeamMemberRowShape): TeamMemberRecord => toTeamMemberRecordBase(row)

const toBillingSettingsRecordBase = toRecord<OrganizationRowShape, readonly [
  'id',
  'billingEmail',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'stripePaymentMethodId',
  'stripeMeteredSubscriptionItemId',
  'creditsBalance',
  'reservedCredits',
  'autoRechargeEnabled',
  'autoRechargeThreshold',
  'autoRechargeAmount',
  'isSubscribed',
  'subscriptionStatus',
  'subscriptionPlan',
  'subscriptionStartedAt',
  'subscriptionEndsAt',
  'subscriptionCurrentPeriodEnd'
]>([
  'id',
  'billingEmail',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'stripePaymentMethodId',
  'stripeMeteredSubscriptionItemId',
  'creditsBalance',
  'reservedCredits',
  'autoRechargeEnabled',
  'autoRechargeThreshold',
  'autoRechargeAmount',
  'isSubscribed',
  'subscriptionStatus',
  'subscriptionPlan',
  'subscriptionStartedAt',
  'subscriptionEndsAt',
  'subscriptionCurrentPeriodEnd'
] as const)

export const toBillingSettingsRecord = (row: OrganizationRowShape): BillingSettingsRecord => toBillingSettingsRecordBase(row)

const toUsageRecordBase = toRecord<UsageRecordRowShape, readonly [
  'id',
  'organizationId',
  'category',
  'quantity',
  'unitCostDecimillicents',
  'totalCostDecimillicents',
  'referenceId',
  'stripeUsageRecordId',
  'metadata',
  'recordedAt',
  'createdAt'
]>([
  'id',
  'organizationId',
  'category',
  'quantity',
  'unitCostDecimillicents',
  'totalCostDecimillicents',
  'referenceId',
  'stripeUsageRecordId',
  'metadata',
  'recordedAt',
  'createdAt'
] as const)

export const toUsageRecordRecord = (row: UsageRecordRowShape): UsageRecordRecord => toUsageRecordBase(row)

const toSubscriptionEventRecordBase = toRecord<SubscriptionEventRowShape, readonly [
  'id',
  'stripeEventId',
  'eventType',
  'organizationId',
  'payload',
  'processedAt',
  'createdAt'
]>([
  'id',
  'stripeEventId',
  'eventType',
  'organizationId',
  'payload',
  'processedAt',
  'createdAt'
] as const)

export const toSubscriptionEventRecord = (
  row: SubscriptionEventRowShape
): SubscriptionEventRecord => toSubscriptionEventRecordBase(row)

const toCreditLedgerEntryRecordBase = toRecord<CreditLedgerRowShape, readonly [
  'id',
  'organizationId',
  'amount',
  'entryType',
  'reason',
  'referenceId',
  'balanceAfter',
  'metadata',
  'createdAt'
]>([
  'id',
  'organizationId',
  'amount',
  'entryType',
  'reason',
  'referenceId',
  'balanceAfter',
  'metadata',
  'createdAt'
] as const)

export const toCreditLedgerEntryRecord = (
  row: CreditLedgerRowShape
): CreditLedgerEntryRecord => toCreditLedgerEntryRecordBase(row)
