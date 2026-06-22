import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleUsageMilestoneEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="You are up and running. Here is how to keep the momentum."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>You are up and running, {name}.</Text>
      <Text style={paragraphStyle}>
        That was your first real unit of work, so tx-agent-kit is officially earning its keep for your
        team. Your usage and credit spend now show up on the dashboard.
      </Text>
      <Text style={paragraphStyle}>
        From here it compounds: bring more assets in, invite the rest of the team, and let the
        metering tell you where the value is. Turn on auto-recharge so nothing stalls.
      </Text>
      <Button href={cta} style={buttonStyle}>
        See your usage
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
