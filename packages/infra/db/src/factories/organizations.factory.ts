import type { organizations } from '../schema.js'
import { type OrganizationOnboardingData, type SubscriptionStatus } from '@tx-agent-kit/contracts'
import { generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type OrganizationInsert = typeof organizations.$inferInsert

export interface CreateOrganizationFactoryOptions {
  id?: string
  name?: string
  billingEmail?: string | null
  onboardingData?: OrganizationOnboardingData | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripePaymentMethodId?: string | null
  creditsBalance?: number
  reservedCredits?: number
  autoRechargeEnabled?: boolean
  autoRechargeThreshold?: number | null
  autoRechargeAmount?: number | null
  isSubscribed?: boolean
  subscriptionStatus?: SubscriptionStatus
  subscriptionPlan?: string | null
  subscriptionStartedAt?: Date | null
  subscriptionEndsAt?: Date | null
  subscriptionCurrentPeriodEnd?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export const createOrganizationFactory = (
  options: CreateOrganizationFactoryOptions = {}
): OrganizationInsert => {
  return {
    id: options.id ?? generateId(),
    name: options.name ?? generateUniqueValue('Organization'),
    billingEmail: options.billingEmail ?? null,
    onboardingData: options.onboardingData ?? null,
    stripeCustomerId: options.stripeCustomerId ?? null,
    stripeSubscriptionId: options.stripeSubscriptionId ?? null,
    stripePaymentMethodId: options.stripePaymentMethodId ?? null,
    creditsBalance: options.creditsBalance ?? 0,
    reservedCredits: options.reservedCredits ?? 0,
    autoRechargeEnabled: options.autoRechargeEnabled ?? false,
    autoRechargeThreshold: options.autoRechargeThreshold ?? null,
    autoRechargeAmount: options.autoRechargeAmount ?? null,
    isSubscribed: options.isSubscribed ?? false,
    subscriptionStatus: options.subscriptionStatus ?? 'inactive',
    subscriptionPlan: options.subscriptionPlan ?? null,
    subscriptionStartedAt: options.subscriptionStartedAt ?? null,
    subscriptionEndsAt: options.subscriptionEndsAt ?? null,
    subscriptionCurrentPeriodEnd: options.subscriptionCurrentPeriodEnd ?? null,
    createdAt: options.createdAt ?? generateTimestamp(),
    updatedAt: options.updatedAt ?? generateTimestamp()
  }
}
