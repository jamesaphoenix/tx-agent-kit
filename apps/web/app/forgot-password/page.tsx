'use client'

import { ForgotPasswordForm } from '../../components/ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <section className="card" style={{ maxWidth: '460px', margin: '2rem auto' }}>
      <div className="stack">
        <h1>Forgot password</h1>
        <p className="muted">Enter your account email and we will send a reset link.</p>
        <ForgotPasswordForm />
      </div>
    </section>
  )
}
