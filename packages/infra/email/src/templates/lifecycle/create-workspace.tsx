import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleCreateWorkspaceEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Create a real workspace to keep your team's work together."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Create your first workspace, {name}.</Text>
      <Text style={paragraphStyle}>
        Workspaces are where your team's work lives: shared media assets, members, and the credits
        you spend on each project. You start with a default one, but a named workspace per team or
        project keeps things tidy.
      </Text>
      <Text style={paragraphStyle}>
        Set one up from your organization page, give it a clear name, and you are ready to bring
        people and assets in.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Create a workspace
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
