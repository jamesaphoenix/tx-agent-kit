import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface PaymentFailedEmailProps {
  readonly recipientName: string
  readonly gracePeriodEndsAtDisplay: string
  readonly updatePaymentUrl: string
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
  backgroundColor: '#b91c1c',
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

export const PaymentFailedEmail: React.FC<PaymentFailedEmailProps> = ({
  recipientName,
  gracePeriodEndsAtDisplay,
  updatePaymentUrl
}) => (
  <EmailLayout preview="Your tx-agent-kit subscription payment failed">
    <Text style={headingStyle}>Your subscription payment failed</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      We could not collect your most recent tx-agent-kit subscription payment. Your account is
      currently in a grace period until <strong>{gracePeriodEndsAtDisplay}</strong>. Please
      update your payment method to avoid an interruption.
    </Text>
    <Button href={updatePaymentUrl} style={buttonStyle}>
      Update payment method
    </Button>
    <Text style={paragraphStyle}>
      If you believe this was a mistake, just reply to this email and we will investigate.
    </Text>
  </EmailLayout>
)

export const paymentFailedEmailSubject = 'Action required: your tx-agent-kit payment failed'
