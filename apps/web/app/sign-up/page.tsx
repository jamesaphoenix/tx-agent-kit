'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { AuthForm } from '../../components/AuthForm'
import { useSafeNextPath } from '../../lib/url-state'

function SignUpContent() {
  const nextPath = useSafeNextPath('/org')

  return (
    <div className="auth-shell">
      <div className="auth-main">
        <div className="auth-container">
          <div className="auth-logo">
            <div className="auth-logo-mark">tx</div>
            <span className="auth-logo-wordmark">tx-agent-kit</span>
          </div>

          <div className="auth-header">
            <h1>Create your account</h1>
            <p>Get into your agent organization in under a minute.</p>
          </div>

          <div className="auth-card">
            <AuthForm mode="sign-up" nextPath={nextPath} />
          </div>

          <div className="auth-footer">
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </div>
        </div>
      </div>

      <div className="auth-brand">
        <div className="auth-brand-inner">
          <h2>Start building agent workflows today.</h2>
          <p>
            Get your first autonomous workflow running in minutes with
            built-in observability, type safety, and team collaboration.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/></svg>
              </div>
              <div className="auth-feature-text">
                <h3>Quick Setup</h3>
                <p>Scaffold a new domain and deploy your first workflow in under five minutes.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 3H4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M9 9l6-6M11 3h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="auth-feature-text">
                <h3>Team Collaboration</h3>
                <p>Organizations with role-based access control and invitation management.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 14V8l6-5 6 5v6a1 1 0 01-1 1H4a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 15v-4h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="auth-feature-text">
                <h3>Production Ready</h3>
                <p>Built-in billing, structured logging, and deployment pipelines from day one.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpContent />
    </Suspense>
  )
}
