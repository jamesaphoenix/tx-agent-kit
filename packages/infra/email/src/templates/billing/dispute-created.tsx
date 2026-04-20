import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface DisputeCreatedEmailProps {
  readonly recipientName: string
  readonly chargeAmountUsd: string
  readonly supportUrl: string
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

export const DisputeCreatedEmail: React.FC<DisputeCreatedEmailProps> = ({
  recipientName,
  chargeAmountUsd,
  supportUrl
}) => (
  <EmailLayout preview="A payment dispute was filed on your tx-agent-kit account">
    <Text style={headingStyle}>A payment dispute was filed</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      Your card issuer has filed a dispute for a <strong>{chargeAmountUsd}</strong> charge
      on your tx-agent-kit account. Your credit balance is temporarily frozen while we
      investigate. We will follow up within one business day.
    </Text>
    <Button href={supportUrl} style={buttonStyle}>
      Contact support
    </Button>
    <Text style={paragraphStyle}>
      If you recognise this charge and filed the dispute by mistake, please contact your
      card issuer to withdraw it and let us know so we can restore your account.
    </Text>
  </EmailLayout>
)

export const disputeCreatedEmailSubject = 'Payment dispute filed on your tx-agent-kit account'
