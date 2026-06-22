import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleInactiveFinalEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Anything we can help with before you go quiet for good?"
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Anything we can help with, {name}?</Text>
      <Text style={paragraphStyle}>
        We have not seen you in a while, so this is the last nudge for now. If something got in the
        way, a confusing step, a missing feature, the wrong fit, we would genuinely like to know.
      </Text>
      <Text style={paragraphStyle}>
        Your workspace and assets stay put either way. If now is the right time, your dashboard is one
        click away.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Open your dashboard
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
