'use client'

import { useState, type FormEvent } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

interface WorkspaceOption {
  id: string
  name: string
}

export function CreateInvitationForm({
  workspaces,
  onCreated
}: {
  workspaces: ReadonlyArray<WorkspaceOption>
  onCreated?: () => void | Promise<void>
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!workspaceId) {
      const message = 'Create a workspace first'
      setError(message)
      notify.error(message)
      return
    }

    setPending(true)
    setError(null)

    try {
      await clientApi.createInvitation({ workspaceId, email, role })
      setEmail('')
      notify.success('Invitation sent')
      await onCreated?.()
      setPending(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation'
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
      <h3>Invite teammate</h3>
      <label className="stack">
        <span>Workspace</span>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
      </label>

      <label className="stack">
        <span>Email</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>

      <label className="stack">
        <span>Role</span>
        <select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={pending}>{pending ? 'Sending...' : 'Send invitation'}</button>
    </form>
  )
}
