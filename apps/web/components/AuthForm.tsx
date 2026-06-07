'use client'

import { useState, type SyntheticEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { clientApi } from '../lib/client-api'
import { getWebEnv } from '../lib/env'
import { beginGoogleAuth } from '../lib/google-auth'
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

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58Z"
    />
  </svg>
)

export function AuthForm({ mode, nextPath }: { mode: 'sign-in' | 'sign-up'; nextPath: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const actionLabel = mode === 'sign-up' ? 'Create account' : 'Sign in'

  // Only gate sign-up, and only when a Turnstile site key is configured.
  const turnstileSiteKey = mode === 'sign-up' ? getWebEnv().TURNSTILE_SITE_KEY : undefined
  const turnstileRequired = Boolean(turnstileSiteKey)

  // Google login is only configured in staging/prod. Hide the button in local
  // dev (KISS) where GOOGLE_OIDC_* is blank and the flow would just error.
  const googleSignInEnabled = getWebEnv().NODE_ENV !== 'development'

  const onGoogle = async () => {
    if (pending || googlePending) {
      return
    }

    setGooglePending(true)
    setError(null)

    try {
      // On success the browser navigates to Google and this component unmounts,
      // so we intentionally leave googlePending true to keep the button disabled
      // until the redirect happens.
      await beginGoogleAuth(nextPath)
    } catch (error_) {
      const message = notify.apiError(error_, 'Failed to start Google sign-in', {
        id: 'auth-google-error'
      })
      setError(message)
      setGooglePending(false)
    }
  }

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
      queryClient.clear()
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
      {googleSignInEnabled && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full relative"
            onClick={() => {
              void onGoogle()
            }}
            disabled={pending || googlePending}
          >
            {googlePending ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                <span className="text-sm">Redirecting to Google...</span>
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <GoogleIcon />
                <span>Continue with Google</span>
              </span>
            )}
          </Button>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

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
        disabled={pending || googlePending || (turnstileRequired && !turnstileToken)}
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
