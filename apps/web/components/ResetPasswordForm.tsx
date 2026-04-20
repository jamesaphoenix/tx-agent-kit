'use client'

import { useRouter } from 'next/navigation'
import { type SyntheticEvent, useState } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isTokenMissing = !token || token.trim() === ''
  const tokenError = isTokenMissing ? 'Reset token is missing or invalid' : null

  const onSubmit = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ) => {
    event.preventDefault()
    setError(null)

    if (isTokenMissing) {
      setError('Reset token is missing or invalid')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setPending(true)

    try {
      await clientApi.resetPassword({ token, password })
      notify.success('Password updated. Please sign in.')
      router.replace('/sign-in')
    } catch (submitError) {
      const reason = notify.apiError(submitError, 'Password reset failed')
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
        <Label htmlFor="reset-password">New password</Label>
        <Input
          id="reset-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={isTokenMissing}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reset-confirm-password">Confirm password</Label>
        <Input
          id="reset-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Repeat your new password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={isTokenMissing}
        />
      </div>

      {tokenError && (
        <p className="text-sm text-destructive" role="alert">
          {tokenError}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button className="w-full" type="submit" disabled={pending || isTokenMissing}>
        {pending ? 'Updating...' : 'Update password'}
      </Button>
    </form>
  )
}
