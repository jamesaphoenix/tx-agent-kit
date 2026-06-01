'use client'

import { useState, type SyntheticEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'
import { getWebEnv } from '../lib/env'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'
import { TurnstileWidget } from './TurnstileWidget'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

const Spinner = ({ className }: { className?: string }) => (
  <svg
    className={`animate-spin ${className ?? ''}`}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="3"
      className="opacity-20"
    />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
)

export function AuthForm({ mode, nextPath }: { mode: 'sign-in' | 'sign-up'; nextPath: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const actionLabel = mode === 'sign-up' ? 'Create account' : 'Sign in'

  // Only gate sign-up, and only when a Turnstile site key is configured.
  const turnstileSiteKey = mode === 'sign-up' ? getWebEnv().TURNSTILE_SITE_KEY : undefined
  const turnstileRequired = Boolean(turnstileSiteKey)

  const onSubmit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ) => {
    event.preventDefault()
    if (pending) {
      return
    }

    setPending(true)

    try {
      if (mode === 'sign-up') {
        await clientApi.signUp({ email, password, name }, turnstileToken ?? undefined)
      } else {
        await clientApi.signIn({ email, password })
      }

      const principal = await clientApi.me()
      sessionStoreActions.setPrincipal(principal)
      setError(null)
      notify.success(mode === 'sign-up' ? 'Account created successfully' : 'Signed in successfully')
      router.push(nextPath)
    } catch (error_) {
      const message = notify.apiError(
        error_,
        mode === 'sign-up' ? 'Failed to create account' : 'Failed to sign in',
        { id: `auth-${mode}-error` }
      )
      setError(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        void onSubmit(event)
      }}
      aria-busy={pending}
    >
      {mode === 'sign-up' && (
        <div className="space-y-2">
          <Label htmlFor="auth-name">Name</Label>
          <Input
            id="auth-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jane Founder"
            required
            disabled={pending}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="auth-email">Email</Label>
        <Input
          id="auth-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="auth-password">Password</Label>
        <Input
          id="auth-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          minLength={8}
          required
          disabled={pending}
        />
      </div>

      {turnstileSiteKey && (
        <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
      )}

      <div className="min-h-[1.5rem]" aria-live="polite" aria-atomic="true">
        {error && (
          <div className="text-sm text-destructive" role="alert">
            {error}
          </div>
        )}
      </div>

      <Button
        className="w-full relative"
        type="submit"
        disabled={pending || (turnstileRequired && !turnstileToken)}
      >
        <span className={pending ? 'opacity-0' : undefined}>{actionLabel}</span>
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center gap-2">
            <Spinner />
            <span className="text-sm">
              {mode === 'sign-up' ? 'Creating account...' : 'Signing in...'}
            </span>
          </span>
        )}
      </Button>
    </form>
  )
}
