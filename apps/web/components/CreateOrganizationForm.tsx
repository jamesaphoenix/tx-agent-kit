'use client'

import { useState, type SyntheticEvent } from 'react'
import { useOrganizationsCreateOrganization } from '../lib/api/generated/organizations/organizations'
import { notify } from '../lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CreateOrganizationForm({
  onCreated
}: {
  onCreated?: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mutation = useOrganizationsCreateOrganization({
    mutation: {
      onSuccess: () => {
        setName('')
        setErrorMessage(null)
        notify.success('Organization created')
        void onCreated?.()
      },
      onError: (error) => {
        setErrorMessage(notify.apiError(error, 'Failed to create organization'))
      }
    }
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    setErrorMessage(null)
    mutation.mutate({ data: { name } })
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <h3 className="text-base font-semibold">Create Organization</h3>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Growth Experiments" minLength={2} maxLength={64} required />
      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
      ) : null}
      <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Creating...' : 'Create organization'}</Button>
    </form>
  )
}
