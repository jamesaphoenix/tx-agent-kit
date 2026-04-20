'use client'

import { type SyntheticEvent, useState } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

const successMessage = 'If an account exists for that email, a reset link has been sent.'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await clientApi.forgotPassword({ email })
      setMessage(successMessage)
      notify.success(successMessage)
    } catch (submitError) {
      const reason = notify.apiError(submitError, 'Request failed')
      setError(reason)
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
    >
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          inputMode="email"
          required
        />
      </div>

      {message && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button className="w-full" type="submit" disabled={pending || message !== null}>
        {pending ? 'Sending...' : 'Send reset link'}
      </Button>
    </form>
  )
}
