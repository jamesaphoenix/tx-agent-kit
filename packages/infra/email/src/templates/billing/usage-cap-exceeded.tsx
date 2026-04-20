import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface UsageCapExceededEmailProps {
  readonly recipientName: string
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

export const UsageCapExceededEmail: React.FC<UsageCapExceededEmailProps> = ({
  recipientName,
  capUsd,
  dashboardUrl
}) => (
  <EmailLayout preview="You have hit your monthly usage cap">
    <Text style={headingStyle}>Monthly usage cap reached</Text>
    <Text style={paragraphStyle}>Hi {recipientName},</Text>
    <Text style={paragraphStyle}>
      Your tx-agent-kit usage has hit the <strong>{capUsd}</strong> monthly cap you
      configured. New AI operations are paused until the period resets or the cap is
      raised. Existing scheduled campaigns will resume automatically once there is
      headroom.
    </Text>
    <Button href={dashboardUrl} style={buttonStyle}>
      Raise cap or wait for reset
    </Button>
    <Text style={paragraphStyle}>
      You set this cap to protect against surprise bills — we honour it by default.
    </Text>
  </EmailLayout>
)

export const usageCapExceededEmailSubject = 'tx-agent-kit monthly usage cap reached'
