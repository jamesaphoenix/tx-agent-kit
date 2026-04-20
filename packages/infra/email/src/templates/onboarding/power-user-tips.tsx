import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface PowerUserTipsEmailProps {
  readonly analyticsUrl: string
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

const tipHeadingStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#111827',
  margin: '24px 0 8px',
  lineHeight: '22px'
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

export const PowerUserTipsEmail: React.FC<PowerUserTipsEmailProps> = ({
  analyticsUrl,
  unsubscribeUrl
}) => (
  <EmailLayout
    preview="3 tips from teams getting the most out of tx-agent-kit"
    unsubscribeUrl={unsubscribeUrl}
  >
    <Text style={headingStyle}>
      3 tips from teams getting the most out of tx-agent-kit
    </Text>

    <Text style={paragraphStyle}>
      You have been using tx-agent-kit for about a week now. Here are the patterns we see from
      teams that get the best results:
    </Text>

    <Text style={tipHeadingStyle}>1. Batch your content creation</Text>
    <Text style={paragraphStyle}>
      Instead of creating posts one at a time, use the campaign editor to draft a full week
      of content in one session. Our AI agents can help you generate variations and adapt
      each piece for different platforms. Teams that batch content save an average of 5 hours
      per week.
    </Text>

    <Text style={tipHeadingStyle}>2. Use campaign analytics to iterate</Text>
    <Text style={paragraphStyle}>
      After your first campaign runs, check your analytics dashboard to see which posts
      performed best. Use those insights to inform your next batch of content. The feedback
      loop is where the real value compounds.
    </Text>

    <Text style={tipHeadingStyle}>3. Connect all your channels</Text>
    <Text style={paragraphStyle}>
      tx-agent-kit works best when all your social accounts are connected. Each additional
      channel gives our AI agents more context to optimize your content strategy and
      scheduling across platforms.
    </Text>

    <Button href={analyticsUrl} style={buttonStyle}>
      Check your campaign analytics
    </Button>
  </EmailLayout>
)

export const powerUserTipsEmailSubject =
  '3 tips from teams getting the most out of tx-agent-kit'
