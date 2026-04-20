'use client'

import type { InvitationAssignableRole } from '@tx-agent-kit/contracts'
import { useState, type SyntheticEvent } from 'react'
import { useOrganizationsCreateInvitation } from '../lib/api/generated/organizations/organizations'
import { notify } from '../lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface OrganizationOption {
  id: string
  name: string
}

export function CreateInvitationForm({
  organizations,
  onCreated
}: {
  organizations: ReadonlyArray<OrganizationOption>
  onCreated?: () => void | Promise<void>
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitationAssignableRole>('member')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mutation = useOrganizationsCreateInvitation({
    mutation: {
      onSuccess: () => {
        setEmail('')
        setErrorMessage(null)
        notify.success('Invitation sent')
        void onCreated?.()
      },
      onError: (error) => {
        setErrorMessage(notify.apiError(error, 'Failed to send invitation'))
      }
    }
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    setErrorMessage(null)
    if (!organizationId) {
      notify.error('Create an organization first')
      return
    }
    mutation.mutate({
      data: { organizationId, email, role }
    })
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <h3 className="text-base font-semibold">Invite teammate</h3>
      <div className="space-y-2">
        <Label htmlFor="invitation-organization">Organization</Label>
        <select
          id="invitation-organization"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
          className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="invitation-email">Email</Label>
        <Input id="invitation-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label>Role</Label>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as InvitationAssignableRole)}
          className="flex h-8 w-full items-center rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
      ) : null}

      <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Sending...' : 'Send invitation'}</Button>
    </form>
  )
}
