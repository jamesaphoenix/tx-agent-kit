'use client'

import type { ReactNode } from 'react'
import { AppProviders } from '../components/providers/AppProviders'
import './globals.css'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <main>{children}</main>
        </AppProviders>
      </body>
    </html>
  )
}
