'use client'

import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

const successMessage = 'If an account exists for that email, a reset link has been sent.'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await clientApi.forgotPassword({ email })
      setMessage(successMessage)
      notify.success(successMessage)
    } catch (submitError) {
      const reason = submitError instanceof Error ? submitError.message : 'Request failed'
      setError(reason)
      notify.error(reason)
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        void onSubmit(event)
      }}
    >
      <label className="stack">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          inputMode="email"
          required
        />
      </label>

      {message && (
        <p className="muted" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Send reset link'}
      </button>

      <p className="muted">
        Back to <Link href="/sign-in">sign in</Link>
      </p>
    </form>
  )
}
