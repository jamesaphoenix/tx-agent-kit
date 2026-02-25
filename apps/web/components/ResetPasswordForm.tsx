'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isTokenMissing = !token || token.trim() === ''
  const tokenError = isTokenMissing ? 'Reset token is missing or invalid' : null

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
      const reason = submitError instanceof Error ? submitError.message : 'Password reset failed'
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
        <span>New password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={isTokenMissing}
        />
      </label>

      <label className="stack">
        <span>Confirm password</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Repeat your new password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={isTokenMissing}
        />
      </label>

      {tokenError && (
        <p className="error" role="alert">
          {tokenError}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || isTokenMissing}>
        {pending ? 'Updating...' : 'Update password'}
      </button>

      <p className="muted">
        Return to <Link href="/sign-in">sign in</Link>
      </p>
    </form>
  )
}
