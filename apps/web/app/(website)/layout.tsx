'use client'

import type { ReactNode } from 'react'
import { WebsiteHeader } from '../../components/WebsiteHeader'
import { WebsiteFooter } from '../../components/WebsiteFooter'

export default function WebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WebsiteHeader />
      {children}
      <WebsiteFooter />
    </>
  )
}
