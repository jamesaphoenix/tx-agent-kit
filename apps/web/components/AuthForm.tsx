'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'

export function AuthForm({ mode, nextPath }: { mode: 'sign-in' | 'sign-up'; nextPath: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) {
      return
    }

    setPending(true)

    try {
      if (mode === 'sign-up') {
        await clientApi.signUp({ email, password, name })
      } else {
        await clientApi.signIn({ email, password })
      }

      const principal = await clientApi.me()
      sessionStoreActions.setPrincipal(principal)
      setError(null)
      notify.success(mode === 'sign-up' ? 'Account created successfully' : 'Signed in successfully')
      router.push(nextPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      notify.error(message, { id: `auth-${mode}-error` })
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        void onSubmit(event)
      }}
    >
      {mode === 'sign-up' && (
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-name">Name</label>
          <input
            id="auth-name"
            className="auth-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jane Founder"
            required
          />
        </div>
      )}

      <div className="auth-field">
        <label className="auth-label" htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          className="auth-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          required
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          className="auth-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          minLength={8}
          required
        />
      </div>

      <div className="auth-error-slot" aria-live="polite" aria-atomic="true">
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <button className="auth-submit" type="submit" disabled={pending}>
        {pending ? 'Working...' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  )
}
