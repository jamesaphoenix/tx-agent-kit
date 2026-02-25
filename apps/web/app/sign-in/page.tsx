'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { AuthForm } from '../../components/AuthForm'
import { useSafeNextPath } from '../../lib/url-state'

function SignInContent() {
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
            <h1>Welcome back</h1>
            <p>Sign in to your account to continue.</p>
          </div>

          <div className="auth-card">
            <AuthForm mode="sign-in" nextPath={nextPath} />
          </div>

          <div className="auth-footer">
            <Link href="/forgot-password">Forgot password?</Link>
          </div>

          <div className="auth-footer">
            Don&apos;t have an account? <Link href="/sign-up">Create one</Link>
          </div>
        </div>
      </div>

      <div className="auth-brand">
        <div className="auth-brand-inner">
          <h2>Agent-first execution, built for speed.</h2>
          <p>
            Orchestrate autonomous workflows with type-safe contracts,
            structured observability, and production-grade infrastructure.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9h12M11 5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="auth-feature-text">
                <h3>Autonomous Workflows</h3>
                <p>Orchestrate complex multi-step agent tasks with Temporal and Effect.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="auth-feature-text">
                <h3>Type-Safe Contracts</h3>
                <p>Schema-driven validation ensures correctness at every service boundary.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4M4.2 13.8l1.4-1.4M12.4 5.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div className="auth-feature-text">
                <h3>Structured Observability</h3>
                <p>Traces, metrics, and logs for every execution — out of the box.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  )
}
