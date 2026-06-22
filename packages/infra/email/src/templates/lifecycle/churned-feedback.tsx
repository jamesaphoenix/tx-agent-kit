import { Button, Link, Text } from '@react-email/components'
import * as React from 'react'
import { EmailLayout } from '../shared/layout.js'
import { firstUrl, greetingName, type LifecycleEmailProps } from './props.js'
import { RoadmapLink } from './roadmap-link.js'
import { buttonStyle, headingStyle, mutedTextStyle, paragraphStyle, secondaryLinkStyle } from './styles.js'

export const LifecycleChurnedFeedbackEmail: React.FC<LifecycleEmailProps> = (props) => {
  const name = greetingName(props.userName)
  const cta = firstUrl(props.ctaUrl, props.feedbackBoardUrl, props.appUrl)
  return (
    <EmailLayout
      preview="One question before you go: what would have made you stay?"
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <Text style={headingStyle}>One honest question, {name}.</Text>
      <Text style={paragraphStyle}>
        Before you go for good: what would have made tx-agent-kit worth staying for? Not a survey,
        just one line. The missing capability, the rough edge, the thing that did not fit your team.
      </Text>
      <Text style={paragraphStyle}>
        We read every reply and ship from it. Your one sentence genuinely shapes what comes next.
      </Text>
      <Button href={cta} style={buttonStyle}>
        Tell us what we missed
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
