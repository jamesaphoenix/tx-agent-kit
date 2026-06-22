import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleInactiveNudgeEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Your workspace is waiting where you left it."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Your workspace is waiting, {name}.</Text>
      <Text style={paragraphStyle}>
        It has been quiet for a while. Your workspaces, assets, and team are exactly where you left
        them, ready to pick back up.
      </Text>
      <Text style={paragraphStyle}>
        One small thing gets the momentum back: a quick upload, a workflow run, or just checking in on
        your dashboard.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Jump back in
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
