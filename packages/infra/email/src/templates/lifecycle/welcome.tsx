import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleWelcomeEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Welcome to tx-agent-kit. Your organization is ready."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Welcome aboard, {name}.</Text>
      <Text style={paragraphStyle}>
        Your account and first organization are set up. tx-agent-kit gives your team workspaces,
        shared media assets, and metered credits for the work your agents do, all billed in one place.
      </Text>
      <Text style={paragraphStyle}>
        The fastest path to value is short: finish onboarding, spin up a workspace, and invite a
        teammate. Your dashboard is the place to start.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Open your dashboard
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
