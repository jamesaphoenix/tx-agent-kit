import { Link, Text } from '@react-email/components'
import * as React from 'react'
import { mutedTextStyle, secondaryLinkStyle } from './styles.js'

export interface RoadmapLinkProps {
  readonly roadmapUrl?: string
}

/**
 * "Shape the roadmap ->" line. Renders nothing when no roadmap URL is supplied,
 * so templates can drop it in unconditionally.
 */
export const RoadmapLink: React.FC<RoadmapLinkProps> = ({ roadmapUrl }) => {
  const trimmed = (roadmapUrl ?? '').trim()
  if (trimmed.length === 0) {
    return null
  }
  return (
    <Text style={mutedTextStyle}>
      <Link href={trimmed} style={secondaryLinkStyle}>
        Shape the roadmap {'->'}
      </Link>
    </Text>
  )
}
