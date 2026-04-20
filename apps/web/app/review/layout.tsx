'use client'

import type { ReactNode } from 'react'

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="px-6 py-4 border-b bg-background">
        <span className="font-semibold text-foreground">
          tx-agent-kit Review
        </span>
      </header>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}
