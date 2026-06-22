import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleActivationTipsEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Three quick ways to get value from tx-agent-kit fast."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Three tips to move fast, {name}.</Text>
      <Text style={paragraphStyle}>
        1. Name your workspaces by team or project so credits and assets stay easy to track.
      </Text>
      <Text style={paragraphStyle}>
        2. Upload the assets your team reuses once, then everyone pulls from the same library.
      </Text>
      <Text style={paragraphStyle}>
        3. Watch your credit balance on the dashboard and turn on auto-recharge so work never stalls
        mid-run.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Go to your dashboard
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
