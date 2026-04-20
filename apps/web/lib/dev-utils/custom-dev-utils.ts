'use client'

import type { Organization, Team } from '@tx-agent-kit/contracts'
import { authMe, authSignOut, authSignUp } from '@/lib/api/generated/auth/auth'
import {
  billingCompleteLocalBillingSetup,
  billingCreateCheckoutSession
} from '@/lib/api/generated/billing/billing'
import {
  organizationsCreateOrganization,
  organizationsUpdateOrganization
} from '@/lib/api/generated/organizations/organizations'
import type { OrganizationsUpdateOrganizationBodyOnboardingData } from '@/lib/api/generated/schemas/organizationsUpdateOrganizationBodyOnboardingData'
import { teamsCreateTeam } from '@/lib/api/generated/teams/teams'
import { clearAuthToken, writeAuthToken } from '@/lib/auth-token'
import { readBrowserLocationState } from '@/lib/url-state'
import { sessionStoreActions } from '@/stores/session-store'

export type CustomDevUtilsPresetId =
  | 'free-workspace'
  | 'local-pro-credits'
  | 'local-pro-credits-stripe-checkout'
  | 'stripe-pro-checkout'

export interface CustomDevUtilsDraft {
  readonly emailPrefix: string
  readonly userNameBase: string
  readonly organizationBaseName: string
  readonly workspaceBaseName: string
}

export interface CustomDevUtilsResult {
  readonly email: string
  readonly password: string
  readonly userName: string
  readonly organization: Organization
  readonly team: Team
  readonly checkoutUrl: string | null
}

export const CUSTOM_DEV_UTILS_PASSWORD = 'tx-agent-kit-dev-12345'

export const defaultCustomDevUtilsDraft = (): CustomDevUtilsDraft => ({
  emailPrefix: 'dev-utils',
  userNameBase: 'Dev User',
  organizationBaseName: 'Dev Org',
  workspaceBaseName: 'Sandbox'
})

const defaultSeedBrandSettings = {
  colors: {
    primary: '#0F766E',
    secondary: '#134E4A',
    accent: '#F59E0B',
    background: '#FFFBEB',
    text: '#111827'
  },
  brandGuidelines: 'Keep the seeded workspace clean, direct, and ready for internal QA.',
  industry: 'technology',
  targetAudience: 'internal QA and product development'
} as const

const normalizeToken = (value: string, fallback: string): string => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

const buildSeedSuffix = (): string => {
  const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8)

  return `${stamp}-${randomPart}`
}

const buildSeedIdentity = (draft: CustomDevUtilsDraft) => {
  const suffix = buildSeedSuffix()
  const emailPrefix = normalizeToken(draft.emailPrefix, 'dev-utils')
  const email = `${emailPrefix}+${suffix}@example.com`

  return {
    email,
    userName: `${draft.userNameBase.trim() || 'Dev User'} ${suffix}`,
    organizationName: `${draft.organizationBaseName.trim() || 'Dev Org'} ${suffix}`,
    workspaceName: `${draft.workspaceBaseName.trim() || 'Sandbox'} ${suffix}`
  }
}

const refreshCurrentPrincipal = async (): Promise<void> => {
  const principal = await authMe()
  sessionStoreActions.setPrincipal({
    ...principal,
    permissions: principal.permissions ?? []
  })
}

export const runCustomDevUtilsFlow = async (
  draft: CustomDevUtilsDraft,
  preset: CustomDevUtilsPresetId
): Promise<CustomDevUtilsResult> => {
  const identity = buildSeedIdentity(draft)

  try {
    await authSignOut()
  } catch {
    // Best-effort session reset for switching users in local dev.
  }

  clearAuthToken()
  sessionStoreActions.clear()

  const authResponse = await authSignUp({
    email: identity.email,
    password: CUSTOM_DEV_UTILS_PASSWORD,
    name: identity.userName
  })

  writeAuthToken(authResponse.token)
  await refreshCurrentPrincipal()

  const organization = await organizationsCreateOrganization({
    name: identity.organizationName
  })

  const team = await teamsCreateTeam({
    organizationId: organization.id,
    name: identity.workspaceName,
    brandSettings: defaultSeedBrandSettings
  })

  const completedOnboardingData: OrganizationsUpdateOrganizationBodyOnboardingData = {
    version: 1,
    status: 'completed' as const,
    currentStep: 'completed' as const,
    completedSteps: ['organization_profile', 'workspace_setup', 'goals', 'spend_cap', 'completed'],
    completedAt: new Date().toISOString()
  }

  const completedOrganization = await organizationsUpdateOrganization(organization.id, {
    onboardingData: completedOnboardingData
  })

  const shouldSeedLocalBilling =
    preset === 'local-pro-credits' || preset === 'local-pro-credits-stripe-checkout'

  if (shouldSeedLocalBilling) {
    await billingCompleteLocalBillingSetup(organization.id, {
      subscriptionPlan: 'pro'
    })
  }

  await refreshCurrentPrincipal()

  const shouldStartStripeCheckout =
    preset === 'stripe-pro-checkout' || preset === 'local-pro-credits-stripe-checkout'

  const checkoutUrl =
    shouldStartStripeCheckout
      ? await (async () => {
          const origin = readBrowserLocationState().origin
          const session = await billingCreateCheckoutSession({
            organizationId: organization.id,
            subscriptionPlan: 'pro',
            successUrl: `${origin}/org/${organization.id}/${team.id}`,
            cancelUrl: `${origin}/`
          })
          return session.url
        })()
      : null

  return {
    email: identity.email,
    password: CUSTOM_DEV_UTILS_PASSWORD,
    userName: identity.userName,
    organization: completedOrganization,
    team,
    checkoutUrl
  }
}
