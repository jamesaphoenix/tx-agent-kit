import { Button, Link, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, mutedTextStyle, paragraphStyle, secondaryLinkStyle } from './styles.js'

export const LifecycleFeedbackRequestEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.feedbackBoardUrl, props.appUrl)
  return (
    <EmailLayout
      preview="How is tx-agent-kit working for your team?"
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>How is it going, {name}?</Text>
      <Text style={paragraphStyle}>
        You have been using tx-agent-kit for a couple of weeks now. How is it working for your team?
        One line is plenty: what is landing, what is in the way, what you wish it did.
      </Text>
      <Text style={paragraphStyle}>
        We read every reply and ship from it, so your note directly shapes what we build next.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Share your feedback
      </Button>
      {props.feedbackBoardUrl && props.feedbackBoardUrl.trim().length > 0 ? (
        <Text style={mutedTextStyle}>
          Or see what others are asking for:{' '}
          <Link href={props.feedbackBoardUrl.trim()} style={secondaryLinkStyle}>
            the feedback board
          </Link>
          .
        </Text>
      ) : null}
      <RoadmapLink roadmapUrl={props.roadmapUrl} />
    </EmailLayout>
  )
}
