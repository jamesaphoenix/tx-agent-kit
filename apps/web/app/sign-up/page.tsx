'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { AuthForm } from '../../components/AuthForm'
import { useSafeNextPath } from '../../lib/url-state'

function SignUpContent() {
  const nextPath = useSafeNextPath('/org')

  return (
    <div className="flex min-h-dvh">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-sm font-bold">OS</div>
            <span className="text-lg font-semibold tracking-tight">tx-agent-kit</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Create your account</h1>
            <p className="text-sm text-muted-foreground">Get into your agent organization in under a minute.</p>
          </div>

          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <AuthForm mode="sign-up" nextPath={nextPath} />
          </div>

          <div className="text-center text-sm text-muted-foreground">
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-white p-12">
        <div className="max-w-md space-y-8">
          <h2 className="text-2xl font-bold">Start building agent workflows today.</h2>
          <p className="text-muted-foreground">
            Get your first autonomous workflow running in minutes with
            built-in observability, type safety, and team collaboration.
          </p>
          <div className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Quick Setup</h3>
                <p className="text-sm text-slate-300">Scaffold a new domain and deploy your first workflow in under five minutes.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 3H4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M9 9l6-6M11 3h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Team Collaboration</h3>
                <p className="text-sm text-slate-300">Organizations with role-based access control and invitation management.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 14V8l6-5 6 5v6a1 1 0 01-1 1H4a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 15v-4h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Production Ready</h3>
                <p className="text-sm text-slate-300">Built-in billing, structured logging, and deployment pipelines from day one.</p>
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
