import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface CreditsRechargedEmailProps {
  readonly recipientName: string
  readonly amountUsd: string
  readonly newBalanceUsd: string
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

export const CreditsRechargedEmail: React.FC<CreditsRechargedEmailProps> = ({
  recipientName,
  amountUsd,
  newBalanceUsd,
  dashboardUrl
}) => (
  <EmailLayout preview={`Auto-recharge added ${amountUsd} to your balance`}>
    <Text style={headingStyle}>Auto-recharge succeeded</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      We just added <strong>{amountUsd}</strong> to your tx-agent-kit wallet via auto-recharge.
      Your new available balance is <strong>{newBalanceUsd}</strong>. No action required.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      View your billing page
    </Button>
    <Text style={paragraphStyle}>
      You can pause or adjust auto-recharge any time from billing settings.
    </Text>
  </EmailLayout>
)

export const creditsRechargedEmailSubject = 'Auto-recharge added credits to your tx-agent-kit wallet'
