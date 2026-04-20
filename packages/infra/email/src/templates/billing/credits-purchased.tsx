import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface CreditsPurchasedEmailProps {
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

export const CreditsPurchasedEmail: React.FC<CreditsPurchasedEmailProps> = ({
  recipientName,
  amountUsd,
  newBalanceUsd,
  dashboardUrl
}) => (
  <EmailLayout preview={`Your ${amountUsd} top-up is ready`}>
    <Text style={headingStyle}>Top-up confirmed</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      Thanks — your <strong>{amountUsd}</strong> top-up has landed. Your new available
      balance is <strong>{newBalanceUsd}</strong>. Credits never expire, so take your time
      using them.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      View your balance
    </Button>
  </EmailLayout>
)

export const creditsPurchasedEmailSubject = 'Your tx-agent-kit top-up is ready'
