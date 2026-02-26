'use client'

import type { SubscriptionStatus } from '@tx-agent-kit/contracts'
import type { ReactNode } from 'react'

export interface SubscriptionGateProps {
  subscriptionStatus: SubscriptionStatus
  isSubscribed: boolean
  fallback?: ReactNode
  children: ReactNode
}

const isActiveStatus = (status: SubscriptionStatus): boolean =>
  status === 'active' || status === 'trialing'

export function SubscriptionGate({
  subscriptionStatus,
  isSubscribed,
  fallback = null,
  children
}: SubscriptionGateProps) {
  if (!isSubscribed || !isActiveStatus(subscriptionStatus)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
