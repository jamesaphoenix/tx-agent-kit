import type { ReactNode } from 'react'
import './globals.css'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import { RootClient } from './root-client'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

// This is a fully client-rendered SPA: every route is `'use client'` and reads
// browser-only context (auth/session, useSearchParams) that is null during
// static prerender. Force dynamic rendering app-wide so `next build` does not
// attempt SSG (which throws `Cannot read properties of null (reading 'use')`).
// Route segment config can only be read from a SERVER module, which is why the
// provider tree was split out into the client `RootClient`.
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body>
        <RootClient>{children}</RootClient>
      </body>
    </html>
  )
}
