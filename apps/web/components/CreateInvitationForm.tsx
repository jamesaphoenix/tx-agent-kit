'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'

interface WorkspaceOption {
  id: string
  name: string
}

export function CreateInvitationForm({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!workspaceId) {
      setError('Create a workspace first')
      return
    }

    setPending(true)
    setError(null)

    const response = await clientApi.createInvitation({ workspaceId, email, role })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      setError(body?.error?.message ?? body?.message ?? 'Failed to send invitation')
      setPending(false)
      return
    }

    setEmail('')
    router.refresh()
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
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
