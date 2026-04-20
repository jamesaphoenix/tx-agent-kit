import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface WelcomeEmailProps {
  readonly dashboardUrl: string
  readonly unsubscribeUrl?: string
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

export const WelcomeEmail: React.FC<WelcomeEmailProps> = ({
  dashboardUrl,
  unsubscribeUrl
}) => (
  <EmailLayout
    preview="Welcome to tx-agent-kit — let's get your content moving"
    unsubscribeUrl={unsubscribeUrl}
  >
    <Text style={headingStyle}>Welcome to tx-agent-kit</Text>

    <Text style={paragraphStyle}>
      Thanks for signing up. tx-agent-kit is your agentic social media scheduling and content
      campaign platform. We help you plan, create, and publish content across every channel
      — powered by AI agents that work alongside your team.
    </Text>

    <Text style={paragraphStyle}>
      Whether you are managing a single brand or coordinating campaigns across multiple
      accounts, tx-agent-kit keeps everything moving so you can focus on what matters: creating
      great content.
    </Text>

    <Text style={paragraphStyle}>
      Head to your dashboard to connect your first social account and start scheduling.
    </Text>

    <Button href={dashboardUrl} style={buttonStyle}>
      Go to your dashboard
    </Button>

    <Text style={paragraphStyle}>
      If you have any questions, just reply to this email. We are happy to help.
    </Text>
  </EmailLayout>
)

export const welcomeEmailSubject = "Welcome to tx-agent-kit \u2014 let's get your content moving"
