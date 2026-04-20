import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'

export interface FirstCampaignEmailProps {
  readonly createCampaignUrl: string
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

const listStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#374151',
  margin: '0 0 16px',
  paddingLeft: '20px'
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

export const FirstCampaignEmail: React.FC<FirstCampaignEmailProps> = ({
  createCampaignUrl,
  unsubscribeUrl
}) => (
  <EmailLayout
    preview="Ready to launch your first campaign?"
    unsubscribeUrl={unsubscribeUrl}
  >
    <Text style={headingStyle}>Ready to launch your first campaign?</Text>

    <Text style={paragraphStyle}>
      Now that you have had a chance to explore tx-agent-kit, it is time to create your first
      campaign. A campaign lets you coordinate content across multiple platforms from one place.
    </Text>

    <Text style={paragraphStyle}>Here is what you can do with campaigns:</Text>

    <ul style={listStyle}>
      <li>
        <strong>Multi-platform scheduling</strong> — publish to Twitter/X, LinkedIn, Instagram,
        TikTok, YouTube, and more from a single editor.
      </li>
      <li>
        <strong>AI content assistance</strong> — let our AI agents help you draft, refine, and
        adapt your content for each platform.
      </li>
      <li>
        <strong>Automated workflows</strong> — set up recurring content series and let tx-agent-kit
        handle the scheduling and publishing.
      </li>
    </ul>

    <Text style={paragraphStyle}>
      Creating a campaign takes less than two minutes. Pick your channels, add your content,
      and let tx-agent-kit handle the rest.
    </Text>

    <Button href={createCampaignUrl} style={buttonStyle}>
      Create your first campaign
    </Button>
  </EmailLayout>
)

export const firstCampaignEmailSubject = 'Ready to launch your first campaign?'
