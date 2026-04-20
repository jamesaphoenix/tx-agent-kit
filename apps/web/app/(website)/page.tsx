import type { Metadata } from 'next'
import { config } from '../../config'
import { LandingPageContent } from './LandingPageContent'

export const metadata: Metadata = {
  title: config.name,
  description: config.description
}

export default function LandingPage() {
  return <LandingPageContent />
}
