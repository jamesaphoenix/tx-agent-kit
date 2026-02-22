'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { AuthForm } from '../../components/AuthForm'
import { useSafeNextPath } from '../../lib/url-state'

function SignInContent() {
  const nextPath = useSafeNextPath('/dashboard')

  return (
    <section className="card" style={{ maxWidth: '460px', margin: '2rem auto' }}>
      <div className="stack">
        <h1>Sign in</h1>
        <p className="muted">Access your workspaces, invitations, and execution dashboard.</p>
        <AuthForm mode="sign-in" nextPath={nextPath} />
        <p className="muted">
          No account yet? <Link href="/sign-up">Create one</Link>
        </p>
      </div>
    </section>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  )
}
