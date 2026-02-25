'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { readAuthToken } from '../lib/auth-token'
import { config } from '../config'

export function WebsiteHeader() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    setIsAuthenticated(readAuthToken() !== null)
  }, [])

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`website-header${isScrolled ? ' website-header--scrolled' : ''}`}>
      <div className="website-header-inner">
        <Link href="/" className="website-logo">
          <span className="website-logo-mark">tx</span>
          <span className="website-logo-wordmark">{config.name}</span>
        </Link>

        <nav className="website-nav">
          <Link href="/blog" className="website-nav-link">Blog</Link>
          <Link href="/pricing" className="website-nav-link">Pricing</Link>
          {isAuthenticated ? (
            <Link href="/org" className="website-nav-cta">Go to app</Link>
          ) : (
            <>
              <Link href="/sign-in" className="website-nav-link">Sign in</Link>
              <Link href="/sign-up" className="website-nav-cta">Get started</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
