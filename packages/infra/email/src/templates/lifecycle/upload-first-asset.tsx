import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleUploadFirstAssetEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  return (
    <EmailLayout
      preview="Upload your first asset to get your workspace working."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>Upload your first asset, {name}.</Text>
      <Text style={paragraphStyle}>
        Your workspace is set up, so the next step is to put something in it. Upload an asset your
        team will reuse and it becomes shared across everyone in the workspace.
      </Text>
      <Text style={paragraphStyle}>
        That first upload is the moment the workspace starts doing real work for you, and it takes
        under a minute.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Upload an asset
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
