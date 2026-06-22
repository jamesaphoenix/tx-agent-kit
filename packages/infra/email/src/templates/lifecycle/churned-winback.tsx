import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleChurnedWinbackEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="A lot has shipped. Come back and pick up where you left off."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Come back and pick up where you left off, {name}.</Text>
      <Text style={paragraphStyle}>
        It has been a while, and the product has moved on since you left: smoother onboarding, better
        workspace tools, and clearer credit metering. Your old setup still works with all of it.
      </Text>
      <Text style={paragraphStyle}>
        If the timing is better now, restarting is quick and your workspaces and assets are waiting.
      </Text>
      <Button href={cta} style={buttonStyle}>
        See what is new
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
