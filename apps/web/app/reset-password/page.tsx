'use client'

import { Suspense } from 'react'
import { ResetPasswordForm } from '../../components/ResetPasswordForm'
import { useStringQueryParam } from '../../lib/url-state'

function ResetPasswordContent() {
  const token = useStringQueryParam('token')

  return (
    <section className="card" style={{ maxWidth: '460px', margin: '2rem auto' }}>
      <div className="stack">
        <h1>Reset password</h1>
        <p className="muted">Set a new password for your account.</p>
        <ResetPasswordForm token={token} />
      </div>
    </section>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  )
}
