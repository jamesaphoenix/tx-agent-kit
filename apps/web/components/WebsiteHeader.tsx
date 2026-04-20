'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { config } from '../config'
import { useIsAuthenticated, useIsSessionReady } from '../hooks/use-session-store'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function WebsiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false)
  const isReady = useIsSessionReady()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed top-0 w-full border-b border-border bg-white/80 backdrop-blur z-50 transition-shadow',
        isScrolled && 'shadow-sm'
      )}
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-xs font-extrabold text-white shadow-sm">
            tx
          </span>
          <span className="text-sm font-semibold text-foreground">{config.name}</span>
        </Link>

        <nav aria-label="Main navigation" className="flex items-center gap-1">
          <Link href="/blog" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md">
            Blog
          </Link>
          <Link href="/pricing" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md">
            Pricing
          </Link>
          {(() => {
            if (isReady && isAuthenticated) {
              return (
                <Link href="/org" className={buttonVariants({ size: 'sm' })}>
                  Go to app
                </Link>
              )
            }
            if (isReady) {
              return (
                <>
                  <Link href="/sign-in" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md">
                    Log In
                  </Link>
                  <Link href="/sign-up" className={buttonVariants({ size: 'sm' })}>
                    Sign Up
                  </Link>
                </>
              )
            }
            return <span className="px-3 py-1.5 text-sm text-muted-foreground" aria-hidden="true">...</span>
          })()}
        </nav>
      </div>
    </header>
  )
}
