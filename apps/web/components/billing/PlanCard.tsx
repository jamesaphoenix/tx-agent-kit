'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PLAN_PRICE_CENTS,
  PLAN_STORAGE_LIMIT_BYTES,
  WELCOME_CREDIT_DECIMILLICENTS,
  type SubscriptionPlanSlug
} from '@tx-agent-kit/contracts'
import { formatUsdFromCents, formatUsdFromDecimillicents } from '@/lib/billing-format'

/**
 * A single plan card. Renders price, storage allocation, welcome credit,
 * feature list, and an Upgrade CTA. Highlights the active plan with a
 * "Current plan" badge and disables the CTA so users cannot re-upgrade
 * to the plan they are already on.
 *
 * @spec billing-and-pricing-design §"Plans"
 */
export interface PlanCardProps {
  readonly plan: SubscriptionPlanSlug
  readonly currentPlan: SubscriptionPlanSlug | null
  readonly onUpgrade: (plan: SubscriptionPlanSlug) => void
  readonly isUpgrading: boolean
}

const PLAN_DISPLAY_NAME: Record<SubscriptionPlanSlug, string> = {
  try_me: 'Try Me',
  pro: 'Pro',
  agency: 'Agency'
}

const PLAN_TAGLINE: Record<SubscriptionPlanSlug, string> = {
  try_me: 'Low-risk entry — unlimited members, 10 GB storage',
  pro: 'Production plan — 100 GB storage, 48h email support',
  agency: 'High volume — 500 GB storage, 24h email + Slack'
}

const PLAN_FEATURES: Record<SubscriptionPlanSlug, ReadonlyArray<string>> = {
  try_me: [
    '10 GB storage',
    'Unlimited team members',
    'Pay-as-you-go AI via top-up wallet',
    'Community support'
  ],
  pro: [
    '100 GB storage',
    'Unlimited team members',
    'Pay-as-you-go AI via top-up wallet',
    'Auto-recharge supported',
    'Email support within 48 hours'
  ],
  agency: [
    '500 GB storage',
    'Unlimited team members',
    'Pay-as-you-go AI via top-up wallet',
    'Auto-recharge supported',
    'Email support within 24 hours',
    'Shared Slack channel'
  ]
}

const formatStorage = (bytes: number): string => {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toLocaleString('en-US')} GB`
}

export function PlanCard({
  plan,
  currentPlan,
  onUpgrade,
  isUpgrading
}: PlanCardProps): React.ReactElement {
  const displayName = PLAN_DISPLAY_NAME[plan]
  const tagline = PLAN_TAGLINE[plan]
  const features = PLAN_FEATURES[plan]
  const price = formatUsdFromCents(PLAN_PRICE_CENTS[plan], { minimumFractionDigits: 0 })
  const storage = formatStorage(PLAN_STORAGE_LIMIT_BYTES[plan])
  const welcomeCredit = formatUsdFromDecimillicents(
    WELCOME_CREDIT_DECIMILLICENTS[plan],
    { minimumFractionDigits: 0, maximumFractionDigits: 0 }
  )
  const isCurrent = currentPlan === plan

  const ctaLabel = ((): string => {
    if (isCurrent) {
      return 'Current plan'
    }
    if (isUpgrading) {
      return 'Redirecting…'
    }
    return `Upgrade to ${displayName}`
  })()

  return (
    <Card
      data-testid={`plan-card-${plan}`}
      className={isCurrent ? 'border-primary shadow-md' : undefined}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{displayName}</CardTitle>
          {isCurrent ? <Badge>Current plan</Badge> : null}
        </div>
        <CardDescription>{tagline}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight">{price}</span>
          <span className="text-sm text-muted-foreground">/month</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Included storage
          </span>
          <span className="text-sm font-medium">{storage}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Welcome credit
          </span>
          <span className="text-sm font-medium">
            {welcomeCredit} one-time on first charge
          </span>
        </div>

        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter>
        <Button
          type="button"
          className="btn w-full"
          disabled={isCurrent || isUpgrading}
          onClick={() => onUpgrade(plan)}
        >
          {ctaLabel}
        </Button>
      </CardFooter>
    </Card>
  )
}
