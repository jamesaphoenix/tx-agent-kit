import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleTrialEndingSoonEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Your trial ends soon. Keep your workspaces and assets."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Your trial is ending soon, {name}.</Text>
      <Text style={paragraphStyle}>
        Your trial wraps up shortly. Pick a plan before it ends and your workspaces, assets, members,
        and credit balance carry on without a break.
      </Text>
      <Text style={paragraphStyle}>
        If you are still deciding, the pricing page lays out what each plan includes so you can match
        it to how your team is actually using tx-agent-kit.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Choose a plan
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
