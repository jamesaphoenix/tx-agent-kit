'use client'

import Link from 'next/link'
import { config } from '../../config'
import { ForgotPasswordForm } from '../../components/ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-dvh">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 text-white flex items-center justify-center text-sm font-bold">{config.name.slice(0, 2)}</div>
            <span className="text-lg font-semibold tracking-tight">{config.name}</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Forgot password</h1>
            <p className="text-sm text-muted-foreground">Enter your account email and we&apos;ll send a reset link.</p>
          </div>

          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <ForgotPasswordForm />
          </div>

          <div className="text-center text-sm text-muted-foreground">
            Remember your password? <Link href="/sign-in">Sign in</Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-white p-12">
        <div className="max-w-md space-y-8">
          <h2 className="text-2xl font-bold">Agent-first execution, built for speed.</h2>
          <p className="text-muted-foreground">
            Orchestrate autonomous workflows with type-safe contracts,
            structured observability, and production-grade infrastructure.
          </p>
          <div className="space-y-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9h12M11 5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Autonomous Workflows</h3>
                <p className="text-sm text-slate-300">Orchestrate complex multi-step agent tasks with Temporal and Effect.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Type-Safe Contracts</h3>
                <p className="text-sm text-slate-300">Schema-driven validation ensures correctness at every service boundary.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4M4.2 13.8l1.4-1.4M12.4 5.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Structured Observability</h3>
                <p className="text-sm text-slate-300">Traces, metrics, and logs for every execution — out of the box.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
