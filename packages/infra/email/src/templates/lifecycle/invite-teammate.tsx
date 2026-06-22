import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleInviteTeammateEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Bring a teammate into your workspace."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Bring your team along, {name}.</Text>
      <Text style={paragraphStyle}>
        tx-agent-kit is built for teams. Invite a teammate and they get their own access to your
        workspaces, shared assets, and the work in flight, scoped to the role you give them.
      </Text>
      <Text style={paragraphStyle}>
        Send one invite to start. They accept by email and land straight in the workspace, no extra
        setup on your side.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Invite a teammate
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
