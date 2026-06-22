import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleWeMissYouEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="We saved your workspace. It is here when you want it."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>We saved your workspace, {name}.</Text>
      <Text style={paragraphStyle}>
        Your subscription lapsed, but we did not wipe your work. Your workspaces, assets, and team
        members are all still here, exactly as you left them.
      </Text>
      <Text style={paragraphStyle}>
        If you want to pick back up, reactivating takes a minute and everything is right where it was.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Reactivate your plan
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
