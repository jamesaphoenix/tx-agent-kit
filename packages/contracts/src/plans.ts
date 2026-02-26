import * as Schema from 'effect/Schema'
import {
  permissionActions,
  subscriptionPlanSlugs,
  type PermissionAction,
  type SubscriptionPlanSlug
} from './literals.js'

export const subscriptionPlanSlugSchema = Schema.Literal(...subscriptionPlanSlugs)

const baseGatedPermissions = [
  'manage_billing',
  'manage_team_members',
  'assign_roles',
  'create_teams',
  'delete_teams',
  'create_workflows',
  'edit_workflows',
  'delete_workflows',
  'execute_workflows',
  'view_analytics',
  'export_analytics',
  'manage_integrations',
  'manage_api_keys'
] as const satisfies ReadonlyArray<PermissionAction>

const hasPermission = (permission: string): permission is PermissionAction =>
  permissionActions.some((action) => action === permission)

const resolvePlanPermissions = (permissions: ReadonlyArray<string>): ReadonlyArray<PermissionAction> =>
  permissions.filter(hasPermission)

export interface PlanFeatureLimits {
  workflowExecutionsPerMonth: number | null
  apiCallsPerMonth: number | null
  teamMembers: number | null
}

export interface SubscriptionPlanDefinition {
  slug: SubscriptionPlanSlug
  displayName: string
  description: string
  stripePriceIdEnvKey: 'STRIPE_PRO_PRICE_ID'
  stripeMeteredPriceIdEnvKey: 'STRIPE_PRO_METERED_PRICE_ID'
  featureLimits: PlanFeatureLimits
  gatedPermissions: ReadonlyArray<PermissionAction>
}

export const proPlanDefinition: SubscriptionPlanDefinition = {
  slug: 'pro',
  displayName: 'Pro',
  description: 'Paid subscription plan that unlocks production features and metered usage billing.',
  stripePriceIdEnvKey: 'STRIPE_PRO_PRICE_ID',
  stripeMeteredPriceIdEnvKey: 'STRIPE_PRO_METERED_PRICE_ID',
  featureLimits: {
    workflowExecutionsPerMonth: null,
    apiCallsPerMonth: null,
    teamMembers: null
  },
  gatedPermissions: resolvePlanPermissions(baseGatedPermissions)
}

export const subscriptionPlans: Record<SubscriptionPlanSlug, SubscriptionPlanDefinition> = {
  pro: proPlanDefinition
}

export const getSubscriptionPlan = (slug: SubscriptionPlanSlug): SubscriptionPlanDefinition =>
  subscriptionPlans[slug]
