import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface CreditsRefundedEmailProps {
  readonly recipientName: string
  readonly amountUsd: string
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

export const CreditsRefundedEmail: React.FC<CreditsRefundedEmailProps> = ({
  recipientName,
  amountUsd,
  dashboardUrl
}) => (
  <EmailLayout preview={`Your ${amountUsd} tx-agent-kit refund was processed`}>
    <Text style={headingStyle}>Refund processed</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      We have processed a <strong>{amountUsd}</strong> refund for your tx-agent-kit account.
      If this refund relates to unused credits, your account balance has already been
      adjusted in the billing ledger.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      View billing history
    </Button>
    <Text style={paragraphStyle}>
      If you were not expecting this refund, reply to this email and we will check it for you.
    </Text>
  </EmailLayout>
)

export const creditsRefundedEmailSubject = 'Your tx-agent-kit refund was processed'
