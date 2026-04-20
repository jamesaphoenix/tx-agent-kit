import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

/**
 * Usage cap warning email — parameterized for both the 80% and 95%
 * thresholds. The worker handler picks the matching threshold from the
 * `billing.usage_cap_warning` event payload's `percentUsed` field and
 * fills `percentUsed` + `capUsd` accordingly.
 */
export interface UsageCapWarningEmailProps {
  readonly recipientName: string
  readonly percentUsed: number
  readonly capUsd: string
  readonly dashboardUrl: string
}

const headingStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 16px',
  lineHeight: '28px'
}

const paragraphStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#374151',
  margin: '0 0 16px'
}

const buttonStyle: React.CSSProperties = {
  backgroundColor: '#111827',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 500,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 32px',
  margin: '16px 0'
}

export const UsageCapWarningEmail: React.FC<UsageCapWarningEmailProps> = ({
  recipientName,
  percentUsed,
  capUsd,
  dashboardUrl
}) => (
  <EmailLayout preview={`You are at ${percentUsed}% of your monthly usage cap`}>
    <Text style={headingStyle}>You are at {percentUsed}% of your monthly cap</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      tx-agent-kit usage for this billing period has reached <strong>{percentUsed}%</strong> of
      your configured <strong>{capUsd}</strong> monthly cap. Review your dashboard to see
      which operations are driving the spend, or raise your cap if you need more headroom.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      Review usage
    </Button>
    <Text style={paragraphStyle}>
      We will send one more warning at 95% and hard-stop new operations at 100%.
    </Text>
  </EmailLayout>
)

export const usageCapWarningEmailSubject = 'tx-agent-kit usage cap warning'
