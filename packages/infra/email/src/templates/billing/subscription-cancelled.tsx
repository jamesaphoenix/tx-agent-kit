import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface SubscriptionCancelledEmailProps {
  readonly recipientName: string
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

export const SubscriptionCancelledEmail: React.FC<SubscriptionCancelledEmailProps> = ({
  recipientName,
  dashboardUrl
}) => (
  <EmailLayout preview="Your tx-agent-kit subscription has been cancelled">
    <Text style={headingStyle}>Your subscription is cancelled</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      Your tx-agent-kit subscription has been cancelled. Any remaining credit balance stays
      in your wallet — credits never expire, and you can return any time to spend them
      or re-subscribe.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      View your account
    </Button>
    <Text style={paragraphStyle}>
      If you cancelled by mistake, or want to give us feedback on why, just reply to this
      email.
    </Text>
  </EmailLayout>
)

export const subscriptionCancelledEmailSubject = 'Your tx-agent-kit subscription was cancelled'
