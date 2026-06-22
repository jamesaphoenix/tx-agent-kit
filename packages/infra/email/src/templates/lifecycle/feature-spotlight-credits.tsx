import { Button, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, paragraphStyle } from './styles.js'

export const LifecycleFeatureSpotlightCreditsEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.appUrl)
  const balance = (props.creditBalanceUsd ?? '').trim()
  return (
    <EmailLayout
      preview="Here is what teams build first with their credits."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>What teams build first, {name}.</Text>
      <Text style={paragraphStyle}>
        {balance.length > 0
          ? `You have ${balance} of credits ready. `
          : 'Your credits are ready to spend. '}
        Credits pay for the real work: text, image, and video generation, asset storage, and workflow
        runs. A small balance goes a long way.
      </Text>
      <Text style={paragraphStyle}>
        Most teams start by generating from an uploaded asset or kicking off a workflow. Pick one,
        spend a few credits, and you will see exactly how the metering works.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Put your credits to work
      </Button>
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
