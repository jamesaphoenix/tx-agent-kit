'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'

export function AuthForm({ mode, nextPath }: { mode: 'sign-in' | 'sign-up'; nextPath: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      if (mode === 'sign-up') {
        await clientApi.signUp({ email, password, name })
      } else {
        await clientApi.signIn({ email, password })
      }

      router.push(nextPath)
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Authentication failed')
      setPending(false)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      {mode === 'sign-up' && (
        <label className="stack">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Founder" required />
        </label>
      )}

      <label className="stack">
        <span>Email</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required />
      </label>

      <label className="stack">
        <span>Password</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required />
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={pending}>
        {pending ? 'Working...' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  )
}
