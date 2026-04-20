import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface WelcomeCreditGrantedEmailProps {
  readonly recipientName: string
  readonly amountUsd: string
  readonly planDisplayName: string
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

export const WelcomeCreditGrantedEmail: React.FC<WelcomeCreditGrantedEmailProps> = ({
  recipientName,
  amountUsd,
  planDisplayName,
  dashboardUrl
}) => (
  <EmailLayout preview={`Here is your ${amountUsd} welcome credit from tx-agent-kit`}>
    <Text style={headingStyle}>Welcome to {planDisplayName}</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      Thanks for joining tx-agent-kit. As a one-time welcome bonus, we have credited your
      account with <strong>{amountUsd}</strong>. Use it to try out image, video, and text
      generation — whatever you do not spend will stay in your wallet and never expire.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      Open your dashboard
    </Button>
    <Text style={paragraphStyle}>
      If you have questions, just reply to this email. We read every message.
    </Text>
  </EmailLayout>
)

export const welcomeCreditGrantedEmailSubject = 'Welcome to tx-agent-kit \u2014 here is your welcome credit'
