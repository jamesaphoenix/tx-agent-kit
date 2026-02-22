'use client'

import { useState, type FormEvent } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function AcceptInvitationForm({
  onAccepted
}: {
  onAccepted?: () => void | Promise<void>
}) {
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)

    try {
      await clientApi.acceptInvitation(token)
      setToken('')
      setMessage('Invitation accepted successfully')
      notify.success('Invitation accepted')
      await onAccepted?.()
      setPending(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation'
      setError(message)
      notify.error(message)
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
      <h3>Accept invitation</h3>
      <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste invitation token" required />
      {error && <p className="error">{error}</p>}
      {message && <p>{message}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Accepting...' : 'Accept invitation'}</button>
    </form>
  )
}
