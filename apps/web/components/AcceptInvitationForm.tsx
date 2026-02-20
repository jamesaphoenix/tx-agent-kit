'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'

export function AcceptInvitationForm() {
  const router = useRouter()
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
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to accept invitation')
      setPending(false)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h3>Accept invitation</h3>
      <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste invitation token" required />
      {error && <p className="error">{error}</p>}
      {message && <p>{message}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Accepting...' : 'Accept invitation'}</button>
    </form>
  )
}
