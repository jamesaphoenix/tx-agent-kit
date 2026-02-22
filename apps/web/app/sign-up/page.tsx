'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { AuthForm } from '../../components/AuthForm'
import { useSafeNextPath } from '../../lib/url-state'

function SignUpContent() {
  const nextPath = useSafeNextPath('/dashboard')

  return (
    <section className="card" style={{ maxWidth: '460px', margin: '2rem auto' }}>
      <div className="stack">
        <h1>Create account</h1>
        <p className="muted">Get into your agent workspace in under a minute.</p>
        <AuthForm mode="sign-up" nextPath={nextPath} />
        <p className="muted">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    </section>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpContent />
    </Suspense>
  )
}
