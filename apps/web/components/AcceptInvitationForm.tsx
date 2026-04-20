'use client'

import { useState, type SyntheticEvent } from 'react'
import { useOrganizationsAcceptInvitation } from '../lib/api/generated/organizations/organizations'
import { notify } from '../lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AcceptInvitationForm({
  onAccepted
}: {
  onAccepted?: () => void | Promise<void>
}) {
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const mutation = useOrganizationsAcceptInvitation({
    mutation: {
      onSuccess: () => {
        setToken('')
        setMessage('Invitation accepted successfully')
        notify.success('Invitation accepted')
        void onAccepted?.()
      },
      onError: () => { notify.error('Failed to accept invitation') }
    }
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    mutation.mutate({ token })
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <h3 className="text-base font-semibold">Accept invitation</h3>
      <Input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste invitation token" required />
      {mutation.error && <p className="text-sm text-destructive">Failed to accept invitation</p>}
      {message && <p>{message}</p>}
      <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Accepting...' : 'Accept invitation'}</Button>
    </form>
  )
}
