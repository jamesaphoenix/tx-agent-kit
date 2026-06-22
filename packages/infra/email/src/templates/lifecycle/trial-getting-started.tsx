import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleTrialGettingStartedEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Make the most of your trial: a short plan."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Your trial is running, {name}.</Text>
      <Text style={paragraphStyle}>
        A trial is most useful when you put it through real work. The teams who convert do three
        things early: set up a workspace, invite one teammate, and record their first metered usage.
      </Text>
      <Text style={paragraphStyle}>
        Knock those out this week and you will have a clear read on whether tx-agent-kit fits how your
        team works. Your dashboard tracks all of it.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Open your dashboard
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
