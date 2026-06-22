import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleCompleteOnboardingEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="A couple of details left to finish your setup."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Finish setting up, {name}.</Text>
      <Text style={paragraphStyle}>
        You started strong but the onboarding wizard is not done yet. It takes a minute: name your
        organization, describe your team, and set what you want to get done.
      </Text>
      <Text style={paragraphStyle}>
        Those answers shape your workspace defaults and the suggestions you see next, so it is worth
        the minute.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Finish onboarding
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
