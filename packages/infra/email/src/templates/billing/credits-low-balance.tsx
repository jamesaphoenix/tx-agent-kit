import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface CreditsLowBalanceEmailProps {
  readonly recipientName: string
  readonly currentBalanceUsd: string
  readonly thresholdUsd: string
  readonly topUpUrl: string
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

export const CreditsLowBalanceEmail: React.FC<CreditsLowBalanceEmailProps> = ({
  recipientName,
  currentBalanceUsd,
  thresholdUsd,
  topUpUrl
}) => (
  <EmailLayout preview={`Your tx-agent-kit balance is ${currentBalanceUsd}`}>
    <Text style={headingStyle}>Your credit balance is running low</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      Your available balance has dropped to <strong>{currentBalanceUsd}</strong> — below your
      configured auto-recharge threshold of {thresholdUsd}. Top up now to avoid interruptions
      to your AI workflows.
    </Text>
    <Button href={topUpUrl} style={buttonStyle}>
      Top up credits
    </Button>
    <Text style={paragraphStyle}>
      You can also raise your auto-recharge amount from the billing settings page.
    </Text>
  </EmailLayout>
)

export const creditsLowBalanceEmailSubject = 'Your tx-agent-kit credit balance is running low'
